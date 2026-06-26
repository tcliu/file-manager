import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { normalizeUploadFileName, fileExists, suggestAvailableFileName } from './file-utils';

export interface UploadResult {
  fileName: string;
  size: number;
}

export async function saveMultipartFiles(
  body: Buffer,
  boundary: string,
  destinationDir: string,
  options: { overwriteExisting?: boolean; onFileSaved?: (file: { fileName: string; size: number }) => void } = {},
): Promise<string[]> {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const delimiter = Buffer.from('\r\n\r\n');
  const uploaded: string[] = [];
  const overwriteExisting = options.overwriteExisting === true;
  const onFileSaved = typeof options.onFileSaved === 'function' ? options.onFileSaved : null;
  let offset = 0;

  while (offset < body.length) {
    const boundaryIndex = body.indexOf(boundaryBuffer, offset);
    if (boundaryIndex === -1) break;

    const nextOffset = boundaryIndex + boundaryBuffer.length;
    const trailer = body.slice(nextOffset, nextOffset + 2).toString();
    if (trailer === '--') break;

    offset = nextOffset + 2;
    const headerEnd = body.indexOf(delimiter, offset);
    if (headerEnd === -1) break;

    const headerText = body.slice(offset, headerEnd).toString('utf8');
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    const contentStart = headerEnd + delimiter.length;
    const nextBoundary = body.indexOf(boundaryBuffer, contentStart);
    if (nextBoundary === -1) break;

    const contentEnd = nextBoundary - 2;
    const fileContent = body.slice(contentStart, contentEnd);
    offset = nextBoundary;

    if (!filenameMatch?.[1]) continue;

    const originalName = normalizeUploadFileName(filenameMatch[1]);
    const targetPath = await resolveUploadTargetPath(destinationDir, originalName, overwriteExisting);

    await writeFile(targetPath, fileContent);
    uploaded.push(path.basename(targetPath));

    if (onFileSaved) {
      onFileSaved({ fileName: path.basename(targetPath), size: fileContent.length });
    }
  }

  return uploaded;
}

async function resolveUploadTargetPath(destinationDir: string, originalName: string, overwriteExisting: boolean): Promise<string> {
  const candidate = path.join(destinationDir, originalName);

  if (overwriteExisting || !(await fileExists(candidate))) {
    return candidate;
  }

  const error = new Error(`File already exists: ${originalName}`) as Error & { code: string; suggestedName: string };
  error.code = 'EFILEEXISTS';
  error.suggestedName = await suggestAvailableFileName(destinationDir, originalName);
  throw error;
}
