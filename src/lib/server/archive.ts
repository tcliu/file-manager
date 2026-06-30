import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import yauzl from 'yauzl';
import archiver from 'archiver';
import { logEvent } from './logging';
import { getRootDirPath } from './config';

export interface ArchiveDirectoryEntry {
  path: string;
  name: string;
  parentPath: string;
  modifiedAt: string;
}

export interface ArchiveFileEntry {
  path: string;
  name: string;
  parentPath: string;
  extension: string;
  size: number;
  modifiedAt: string;
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

function createArchiveDirectoryEntry(relativePath: string, modifiedAt: string): ArchiveDirectoryEntry {
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
    modifiedAt,
  };
}

function createArchiveFileEntry(relativePath: string, size: number, modifiedAt: string): ArchiveFileEntry {
  const extension = path.posix.extname(relativePath).slice(1).toLowerCase();
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    parentPath: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath),
    extension,
    size,
    modifiedAt,
  };
}

function compareArchiveEntries(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path);
}

function formatZipTimestamp(date: Date): string {
  const y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${M}-${d}T${h}:${m}:${s}`;
}

export async function listZipArchiveContents(filePath: string): Promise<ArchiveContents> {
  const zipfile = await yauzl.openPromise(filePath, { lazyEntries: true });
  const directories = new Map<string, ArchiveDirectoryEntry>();
  const files: ArchiveFileEntry[] = [];

  try {
    for await (const entry of zipfile.eachEntry()) {
      const rawPath = entry.fileName;
      const isDirectory = rawPath.endsWith('/');
      const cleanPath = isDirectory ? rawPath.slice(0, -1) : rawPath;
      const normalizedPath = normalizeArchiveEntryPath(cleanPath);
      if (!normalizedPath) continue;

      const modifiedAt = formatZipTimestamp(entry.getLastModDate());
      const parts = normalizedPath.split('/');

      for (let index = 1; index < parts.length; index += 1) {
        const directoryPath = parts.slice(0, index).join('/');
        if (!directories.has(directoryPath)) {
          directories.set(directoryPath, createArchiveDirectoryEntry(directoryPath, modifiedAt));
        }
      }

      if (isDirectory) {
        if (!directories.has(normalizedPath)) {
          directories.set(normalizedPath, createArchiveDirectoryEntry(normalizedPath, modifiedAt));
        }
        continue;
      }

      files.push(createArchiveFileEntry(normalizedPath, entry.uncompressedSize, modifiedAt));
    }
  } finally {
    zipfile.close();
  }

  return {
    directories: [...directories.values()].sort(compareArchiveEntries),
    files: files.sort(compareArchiveEntries),
  };
}

export async function streamZipArchiveEntry(filePath: string, entryPath: string, response: { write: (chunk: Uint8Array) => boolean; end: () => void; on: (event: string, cb: () => void) => void; writableEnded: boolean; headersSent: boolean; writeHead: (status: number, headers: Record<string, string | number>) => void }): Promise<void> {
  const zipfile = await yauzl.openPromise(filePath, { lazyEntries: true });

  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName.replace(/\/$/, '') === entryPath) {
        const readStream = await zipfile.openReadStreamPromise(entry);

        await new Promise<void>((resolveStream, rejectStream) => {
          readStream.on('data', (chunk: Buffer) => {
            response.write(new Uint8Array(chunk));
          });
          readStream.on('end', () => {
            if (!response.writableEnded) response.end();
            resolveStream();
          });
          readStream.on('error', rejectStream);
        });

        return;
      }
    }
    throw new Error(`Archive entry not found: ${entryPath}`);
  } finally {
    zipfile.close();
  }
}

export async function ensureZipArchiveEntryReadable(filePath: string, entryPath: string): Promise<void> {
  const zipfile = await yauzl.openPromise(filePath, { lazyEntries: true });

  try {
    for await (const entry of zipfile.eachEntry()) {
      if (entry.fileName.replace(/\/$/, '') === entryPath) {
        return;
      }
    }
    throw new Error(`Archive entry not found: ${entryPath}`);
  } finally {
    zipfile.close();
  }
}

export async function countFilesRecursive(dirPath: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFilesRecursive(path.join(dirPath, entry.name));
    } else {
      count++;
    }
  }
  return count;
}

export async function createZipArchive(
  cwd: string,
  archivePath: string,
  selectedItems: string[],
  folderName?: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<void> {
  let totalFiles = 0;
  for (const item of selectedItems) {
    const sourcePath = path.join(cwd, item);
    const itemStat = await stat(sourcePath);
    if (itemStat.isDirectory()) {
      totalFiles += await countFilesRecursive(sourcePath);
    } else {
      totalFiles++;
    }
  }

  return new Promise((resolve, reject) => {
    const output = createWriteStream(archivePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.on('progress', (p) => {
      onProgress?.(p.entries.processed, p.entries.total);
    });

    archive.pipe(output);

    (async () => {
      for (const item of selectedItems) {
        const sourcePath = path.join(cwd, item);
        const itemStat = await stat(sourcePath);
        const destPath = folderName ? folderName + '/' + item : item;
        if (itemStat.isDirectory()) {
          archive.directory(sourcePath, destPath);
        } else {
          archive.file(sourcePath, { name: destPath });
        }
      }
      await archive.finalize();
    })().catch(reject);
  });
}
