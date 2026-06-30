import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { normalizeUploadRelativePath, fileExists, suggestAvailableFileName } from './file-utils';

export interface UploadResult {
  fileName: string;
  size: number;
}

interface ActiveUploadPart {
  originalName: string;
  targetPath: string;
  tempPath: string;
  stream: ReturnType<typeof createWriteStream>;
  bytesWritten: number;
}

function parseMultipartFilename(headerText: string): string | null {
  const match = headerText.match(/filename="([^"]*)"/i);
  return match?.[1] ?? null;
}

async function resolveUploadTargetPath(destinationDir: string, originalName: string, overwriteExisting: boolean): Promise<string> {
  const candidate = path.join(destinationDir, originalName);

  if (overwriteExisting || !(await fileExists(candidate))) {
    return candidate;
  }

  const parsed = path.posix.parse(originalName);
  const suggestedBaseName = await suggestAvailableFileName(path.join(destinationDir, parsed.dir), parsed.base);
  const error = new Error(`File already exists: ${originalName}`) as Error & { code: string; suggestedName: string };
  error.code = 'EFILEEXISTS';
  error.suggestedName = parsed.dir ? path.posix.join(parsed.dir, suggestedBaseName) : suggestedBaseName;
  throw error;
}

async function createActiveUploadPart(
  headerText: string,
  destinationDir: string,
  overwriteExisting: boolean,
): Promise<ActiveUploadPart | null> {
  const rawFilename = parseMultipartFilename(headerText);
  if (!rawFilename) {
    return null;
  }

  const originalName = normalizeUploadRelativePath(rawFilename);
  const targetPath = await resolveUploadTargetPath(destinationDir, originalName, overwriteExisting);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${randomUUID()}.uploading`;

  return {
    originalName,
    targetPath,
    tempPath,
    stream: createWriteStream(tempPath),
    bytesWritten: 0,
  };
}

async function writePartChunk(activePart: ActiveUploadPart | null, chunk: Buffer): Promise<void> {
  if (!activePart || chunk.length === 0) {
    return;
  }

  activePart.bytesWritten += chunk.length;

  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      activePart.stream.off('drain', handleDrain);
      reject(error);
    };
    const handleDrain = () => {
      activePart.stream.off('error', handleError);
      resolve();
    };

    activePart.stream.once('error', handleError);

    if (activePart.stream.write(chunk)) {
      activePart.stream.off('error', handleError);
      resolve();
      return;
    }

    activePart.stream.once('drain', handleDrain);
  });
}

async function finalizePart(
  activePart: ActiveUploadPart | null,
  uploaded: string[],
  onFileSaved: ((file: { fileName: string; size: number }) => void) | null,
): Promise<void> {
  if (!activePart) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    activePart.stream.once('error', reject);
    activePart.stream.end(() => resolve());
  });

  await rename(activePart.tempPath, activePart.targetPath);
  uploaded.push(activePart.originalName);
  onFileSaved?.({ fileName: activePart.originalName, size: activePart.bytesWritten });
}

async function cleanupPart(activePart: ActiveUploadPart | null): Promise<void> {
  if (!activePart) {
    return;
  }

  if (!activePart.stream.destroyed) {
    activePart.stream.destroy();
  }

  await rm(activePart.tempPath, { force: true }).catch(() => {});
}

export async function saveMultipartFiles(
  requestBody: unknown,
  boundary: string,
  destinationDir: string,
  options: { overwriteExisting?: boolean; onFileSaved?: (file: { fileName: string; size: number }) => void } = {},
): Promise<string[]> {
  const initialBoundaryBuffer = Buffer.from(`--${boundary}`);
  const boundaryBuffer = Buffer.from(`\r\n--${boundary}`);
  const delimiter = Buffer.from('\r\n\r\n');
  const uploaded: string[] = [];
  const overwriteExisting = options.overwriteExisting === true;
  const onFileSaved = typeof options.onFileSaved === 'function' ? options.onFileSaved : null;
  const nodeStream = Readable.fromWeb(
    requestBody as Parameters<typeof Readable.fromWeb>[0],
  );
  const keepBytes = boundaryBuffer.length + 4;

  let buffer = Buffer.alloc(0);
  let state: 'initial-boundary' | 'headers' | 'body' | 'done' = 'initial-boundary';
  let activePart: ActiveUploadPart | null = null;

  async function processBuffer(atStreamEnd: boolean): Promise<void> {
    while (true) {
      if (state === 'done') {
        return;
      }

      if (state === 'initial-boundary') {
        const boundaryIndex = buffer.indexOf(initialBoundaryBuffer);
        if (boundaryIndex === -1) {
          if (atStreamEnd) throw new Error('Invalid multipart payload');
          return;
        }

        const afterBoundary = boundaryIndex + initialBoundaryBuffer.length;
        if (buffer.length < afterBoundary + 2) {
          if (atStreamEnd) throw new Error('Invalid multipart payload');
          return;
        }

        const trailer = buffer.subarray(afterBoundary, afterBoundary + 2).toString();
        if (trailer === '--') {
          buffer = buffer.subarray(afterBoundary + 2);
          state = 'done';
          return;
        }
        if (trailer !== '\r\n') {
          throw new Error('Invalid multipart payload');
        }

        buffer = buffer.subarray(afterBoundary + 2);
        state = 'headers';
        continue;
      }

      if (state === 'headers') {
        const headerEnd = buffer.indexOf(delimiter);
        if (headerEnd === -1) {
          if (atStreamEnd) throw new Error('Invalid multipart payload');
          return;
        }

        const headerText = buffer.subarray(0, headerEnd).toString('utf8');
        buffer = buffer.subarray(headerEnd + delimiter.length);
        activePart = await createActiveUploadPart(headerText, destinationDir, overwriteExisting);
        state = 'body';
        continue;
      }

      const boundaryIndex = buffer.indexOf(boundaryBuffer);
      if (boundaryIndex === -1) {
        if (atStreamEnd) {
          throw new Error('Invalid multipart payload');
        }

        const writableLength = Math.max(0, buffer.length - keepBytes);
        if (writableLength === 0) {
          return;
        }

        await writePartChunk(activePart, buffer.subarray(0, writableLength));
        buffer = buffer.subarray(writableLength);
        continue;
      }

      if (buffer.length < boundaryIndex + boundaryBuffer.length + 2) {
        if (atStreamEnd) throw new Error('Invalid multipart payload');
        return;
      }

      await writePartChunk(activePart, buffer.subarray(0, boundaryIndex));
      buffer = buffer.subarray(boundaryIndex + boundaryBuffer.length);

      const trailer = buffer.subarray(0, 2).toString();
      await finalizePart(activePart, uploaded, onFileSaved);
      activePart = null;

      if (trailer === '--') {
        buffer = buffer.subarray(2);
        state = 'done';
        return;
      }
      if (trailer !== '\r\n') {
        throw new Error('Invalid multipart payload');
      }

      buffer = buffer.subarray(2);
      state = 'headers';
    }
  }

  try {
    for await (const chunk of nodeStream) {
      buffer = buffer.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([buffer, Buffer.from(chunk)]);
      await processBuffer(false);
    }

    await processBuffer(true);
  } catch (error) {
    await cleanupPart(activePart);
    throw error;
  }

  return uploaded;
}
