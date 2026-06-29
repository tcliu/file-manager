import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { getAppConfig, getRootDirs, getRootDirPath } from './config';
import { PROCESSED_DIR_NAME } from './constants';

export function normalizeRelativeDirectory(relativeDir: string): string {
  const normalizedPath = path.posix.normalize(`/${relativeDir || ''}`).replace(/^\//, '');

  if (normalizedPath === '.' || normalizedPath === '') {
    return '';
  }

  if (normalizedPath.startsWith('..')) {
    throw new Error('Invalid directory path');
  }

  return normalizedPath;
}

export function resolveRootRelativePath(relativePath: string): string {
  const rootDir = getRootDirPath();
  const rootDirs = getRootDirs();
  const normalizedPath = path.normalize(relativePath);

  if (rootDirs.length > 1) {
    const parts = normalizedPath.split(path.sep);
    const rootName = parts[0];
    const rootEntry = rootDirs.find(d => path.basename(d) === rootName);

    if (rootEntry) {
      const remainingPath = parts.slice(1).join(path.sep);
      const resolvedPath = remainingPath ? path.resolve(rootEntry, remainingPath) : rootEntry;
      const relativeToEntry = path.relative(rootEntry, resolvedPath);

      if (relativeToEntry.startsWith('..') || path.isAbsolute(relativeToEntry)) {
        throw new Error('Invalid file path');
      }

      return resolvedPath;
    }
  }

  const resolvedPath = path.resolve(rootDir, normalizedPath);
  const relativeToRoot = path.relative(rootDir, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Invalid file path');
  }

  return resolvedPath;
}

export function resolveListedFilePath(relativePath: string): string {
  return resolveRootRelativePath(relativePath);
}

export function resolveListedDirectoryPath(relativePath: string): string {
  return resolveListedFilePath(relativePath || '.');
}

export function resolveCurrentDirectoryEntryPath(currentDir: string, relativePath: string): string {
  const entryPath = resolveListedFilePath(relativePath);
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const relativeToCurrentDirectory = path.relative(currentDirectoryPath, entryPath);

  if (relativeToCurrentDirectory.startsWith('..') || path.isAbsolute(relativeToCurrentDirectory)) {
    throw new Error('Selection is only allowed inside the current directory');
  }

  return entryPath;
}

export function isUploadSubtreePath(currentDir: string, relativePath: string): boolean {
  const config = getAppConfig();
  const normalizedPath = normalizeRelativeDirectory(relativePath);
  const uploadDirPath = normalizeRelativeDirectory(path.posix.join(currentDir, config.uploadDir));

  if (!normalizedPath || !uploadDirPath) {
    return false;
  }

  return normalizedPath === uploadDirPath || normalizedPath.startsWith(uploadDirPath + '/');
}

export async function fileExists(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  return fileStat?.isFile() ?? false;
}

export function normalizeUploadFileName(value: string): string {
  const fileName = path.basename(String(value || '')).trim();
  if (!fileName || fileName === '.' || fileName === '..') {
    throw new Error('Invalid file name');
  }
  return fileName;
}

export function normalizeUploadRelativePath(value: string): string {
  const normalizedPath = path.posix.normalize(`/${String(value || '').replaceAll('\\', '/')}`).replace(/^\//, '');

  if (!normalizedPath || normalizedPath === '.' || normalizedPath.startsWith('..')) {
    throw new Error('Invalid upload path');
  }

  return normalizedPath;
}

export async function suggestAvailableFileName(destinationDir: string, originalName: string): Promise<string> {
  const parsed = path.parse(originalName);
  let index = 1;

  while (true) {
    const candidateName = `${parsed.name} (${index})${parsed.ext}`;
    if (!(await fileExists(path.join(destinationDir, candidateName)))) {
      return candidateName;
    }
    index += 1;
  }
}

export interface FileEntry {
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
  width?: number;
  height?: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryListing {
  directories: DirectoryEntry[];
  files: FileEntry[];
}

export async function listDirectoryContents(relativeDir: string, selectedExtensions: string[]): Promise<DirectoryListing> {
  const rootDirs = getRootDirs();

  if (rootDirs.length > 1 && (!relativeDir || relativeDir === '.')) {
    const directories: DirectoryEntry[] = [];
    for (const dir of rootDirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
      directories.push({ name: path.basename(dir), path: path.basename(dir) });
    }
    return { directories, files: [] };
  }

  const targetDir = resolveListedDirectoryPath(relativeDir);
  const entries = await readdir(targetDir, { withFileTypes: true });
  const directories: DirectoryEntry[] = [];
  const files: FileEntry[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue;
    const absolutePath = path.join(targetDir, entry.name);
    const relativePath = path.posix.join(relativeDir, entry.name).replace(/^\//, '');

    if (entry.isDirectory()) {
      directories.push({ name: entry.name, path: relativePath });
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).slice(1).toLowerCase();

    if (selectedExtensions.length > 0 && !selectedExtensions.includes(extension)) continue;

    const fileStat = await stat(absolutePath);
    files.push({
      name: entry.name,
      path: relativePath,
      extension,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  }

  return { directories, files };
}

export async function listExtensions(dir: string, relativeDir: string): Promise<string[]> {
  const rootDirs = getRootDirs();
  if (rootDirs.length > 1 && (!relativeDir || relativeDir === '.')) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const extensions = new Set<string>();

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (extension) extensions.add(extension);
  }

  return [...extensions].sort();
}

export function getProcessedVideoPath(filePath: string): string {
  return path.join(path.dirname(filePath), PROCESSED_DIR_NAME, `${path.parse(filePath).name}.mp4`);
}

export function getProcessedImagePath(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(
    path.dirname(filePath),
    PROCESSED_DIR_NAME,
    `${parsed.name}.${parsed.ext.replace(/^\./, '').toLowerCase()}.jpg`,
  );
}

export function getImageThumbnailPath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return path.join(
    path.dirname(sourcePath),
    '.thumbnails',
    `${parsed.name}.${parsed.ext.replace(/^\./, '').toLowerCase()}.jpg`,
  );
}

export function getVideoThumbnailPath(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  return path.join(
    path.dirname(sourcePath),
    '.thumbnails',
    `${parsed.name}.${parsed.ext.replace(/^\./, '').toLowerCase()}.jpg`,
  );
}

export function formatTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function formatSessionExpiryLabel(sessionExpiryMs: number): string {
  if (sessionExpiryMs % 60000 === 0) {
    const minutes = sessionExpiryMs / 60000;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  if (sessionExpiryMs % 1000 === 0) {
    const seconds = sessionExpiryMs / 1000;
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
  }
  return `${sessionExpiryMs} ms`;
}
