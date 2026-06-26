import path from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import archiver from 'archiver';
import { logEvent } from './logging';
import { getRootDirPath } from './config';

export interface ArchiveDirectoryEntry {
  path: string;
  name: string;
  parentPath: string;
}

export interface ArchiveFileEntry {
  path: string;
  name: string;
  parentPath: string;
  extension: string;
}

export interface ArchiveContents {
  directories: ArchiveDirectoryEntry[];
  files: ArchiveFileEntry[];
}

function normalizeArchiveEntryPath(relativePath: string): string {
  const normalizedPath = path.posix.normalize('/' + String(relativePath || '')).replace(/^\//, '');
  if (normalizedPath === '.' || normalizedPath === '') return '';
  if (normalizedPath.startsWith('..')) return '';
  return normalizedPath;
}

function createArchiveDirectoryEntry(relativePath: string): ArchiveDirectoryEntry {
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
  };
}

function createArchiveFileEntry(relativePath: string): ArchiveFileEntry {
  const extension = path.posix.extname(relativePath).slice(1).toLowerCase();
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
    extension,
  };
}

function compareArchiveEntries(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

export async function listZipArchiveContents(filePath: string): Promise<ArchiveContents> {
  const output = await readZipDirectoryListing(filePath);
  const directories = new Map<string, ArchiveDirectoryEntry>();
  const files: ArchiveFileEntry[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const entryLine = rawLine.trim();
    if (!entryLine) continue;

    const isDirectory = entryLine.endsWith('/');
    const normalizedPath = normalizeArchiveEntryPath(isDirectory ? entryLine.slice(0, -1) : entryLine);
    if (!normalizedPath) continue;

    const parts = normalizedPath.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const directoryPath = parts.slice(0, index).join('/');
      if (!directories.has(directoryPath)) {
        directories.set(directoryPath, createArchiveDirectoryEntry(directoryPath));
      }
    }

    if (isDirectory) {
      if (!directories.has(normalizedPath)) {
        directories.set(normalizedPath, createArchiveDirectoryEntry(normalizedPath));
      }
      continue;
    }

    files.push(createArchiveFileEntry(normalizedPath));
  }

  return {
    directories: [...directories.values()].sort(compareArchiveEntries),
    files: files.sort(compareArchiveEntries),
  };
}

function readZipDirectoryListing(filePath: string): Promise<string> {
  const commands: [string, string[]][] = [
    ['unzip', ['-Z1', filePath]],
    ['zipinfo', ['-1', filePath]],
  ];
  let lastError: Error | null = null;

  return (async () => {
    for (const [command, args] of commands) {
      try {
        return await runCommandCapture(command, args);
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw new Error(lastError?.message || 'Unable to read zip archive contents');
  })();
}

function runCommandCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => reject(new Error(`Failed to run ${command}: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) { resolve(stdout); return; }
      const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
      reject(new Error(`Failed to read zip archive with ${command}: ${details}`));
    });
  });
}

export function streamZipArchiveEntry(filePath: string, entryPath: string, response: { write: (chunk: Uint8Array) => boolean; end: () => void; on: (event: string, cb: () => void) => void; writableEnded: boolean; headersSent: boolean; writeHead: (status: number, headers: Record<string, string | number>) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', filePath, entryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let settled = false;

    function finishWithError(error: Error) {
      if (settled) return;
      settled = true;
      if (!child.killed) child.kill('SIGTERM');
      reject(error);
    }

    function finishSuccessfully() {
      if (settled) return;
      settled = true;
      resolve();
    }

    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finishWithError(new Error(`Failed to run unzip: ${error.message}`)));
    child.stdout.on('error', () => finishWithError(new Error('Failed to read archive entry')));
    response.on('close', () => finishWithError(new Error('Download cancelled')));

    child.stdout.pipe(response as any, { end: false });

    child.on('close', (code) => {
      if (settled) return;
      if (code === 0) {
        if (!response.writableEnded) response.end();
        finishSuccessfully();
        return;
      }
      finishWithError(new Error(stderr.trim() || `Failed to read archive entry (exit code ${code})`));
    });
  });
}

export function ensureZipArchiveEntryReadable(filePath: string, entryPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-tqq', filePath, entryPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => reject(new Error(`Failed to run unzip: ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) { resolve(); return; }
      reject(new Error(stderr.trim() || `Failed to validate archive entry (exit code ${code})`));
    });
  });
}

export async function createZipArchive(cwd: string, archivePath: string, selectedItems: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    (async () => {
      for (const item of selectedItems) {
        const sourcePath = path.join(cwd, item);
        const itemStat = await stat(sourcePath);
        if (itemStat.isDirectory()) {
          archive.directory(sourcePath, item);
        } else {
          archive.file(sourcePath, { name: item });
        }
      }
      await archive.finalize();
    })().catch(reject);
  });
}
