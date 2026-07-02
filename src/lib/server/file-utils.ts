import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { getAppConfig, getRootDirs, getRootDirPath } from './config';
import { METADATA_FILE, PROCESSED_DIR_NAME } from './constants';

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
  const normalizedUploadDir = normalizeRelativeDirectory(config.uploadDir);

  if (!normalizedPath || !normalizedUploadDir) {
    return false;
  }

  const pathSegments = normalizedPath.split('/');
  const uploadSegments = normalizedUploadDir.split('/');

  for (let start = 0; start <= pathSegments.length - uploadSegments.length; start += 1) {
    const matchesUploadDir = uploadSegments.every(
      (segment, index) => pathSegments[start + index] === segment,
    );

    if (matchesUploadDir) {
      return true;
    }
  }

  return false;
}

export function isWithinConfiguredUploadDir(relativeDir: string): boolean {
  const normalizedDir = normalizeRelativeDirectory(relativeDir);

  if (!normalizedDir) {
    return false;
  }

  return isUploadSubtreePath(normalizedDir, normalizedDir);
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

export function normalizeUploadDirectoryName(value: string): string {
  const directoryName = normalizeUploadFileName(value);

  if (directoryName.includes('/')) {
    throw new Error('Invalid directory name');
  }

  return directoryName;
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
  extensions: string[];
  availableTags: string[];
  tagIndexMap: Record<string, number>;
}

export async function listDirectoryContents(
  relativeDir: string,
  options: { selectedExtensions?: string[]; nameFilter?: string; tagFilter?: string[]; tagsMap?: Record<string, string[]>; tagIndexMap?: Record<string, number>; untagged?: boolean; tagged?: boolean } = {},
): Promise<DirectoryListing> {
  const rootDirs = getRootDirs();
  const selectedExtensions = options.selectedExtensions ?? [];
  const nameFilter = (options.nameFilter ?? '').trim().toLowerCase();
  const tagFilter = options.tagFilter ?? [];
  const tagsMap = options.tagsMap ?? {};
  const tagIndexMap = options.tagIndexMap ?? {};
  const untagged = options.untagged ?? false;
  const tagged = options.tagged ?? false;

  function itemMatchesTagFilter(filename: string): boolean {
    if (untagged) {
      for (const filenames of Object.values(tagsMap)) {
        if (filenames.includes(filename)) return false;
      }
      return true;
    }
    if (tagged) {
      for (const filenames of Object.values(tagsMap)) {
        if (filenames.includes(filename)) return true;
      }
      return false;
    }
    if (!tagFilter.length) return true;
    for (const tag of tagFilter) {
      const filenames = tagsMap[tag];
      if (filenames?.includes(filename)) return true;
    }
    return false;
  }

  const availableTags = Object.keys(tagsMap).sort();

  if (rootDirs.length > 1 && (!relativeDir || relativeDir === '.')) {
    const directories: DirectoryEntry[] = [];
    for (const dir of rootDirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))) {
      directories.push({ name: path.basename(dir), path: path.basename(dir) });
    }
    return { directories, files: [], extensions: [], availableTags: [...availableTags].sort(), tagIndexMap };
  }

  const targetDir = resolveListedDirectoryPath(relativeDir);
  const entries = await readdir(targetDir, { withFileTypes: true });
  const directories: DirectoryEntry[] = [];
  const extensions = new Set<string>();
  const fileEntries: {
    name: string;
    path: string;
    extension: string;
    absolutePath: string;
  }[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === METADATA_FILE) continue;

    const lowerName = entry.name.toLowerCase();
    const relativePath = path.posix.join(relativeDir, entry.name).replace(/^\//, '');

    if (entry.isDirectory()) {
      if (nameFilter && !lowerName.includes(nameFilter)) continue;
      if (!itemMatchesTagFilter(entry.name)) continue;
      directories.push({ name: entry.name, path: relativePath });
      continue;
    }

    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).slice(1).toLowerCase();
    if (extension) extensions.add(extension);

    if (nameFilter && !lowerName.includes(nameFilter)) continue;
    if (selectedExtensions.length > 0 && !selectedExtensions.includes(extension)) continue;
    if (!itemMatchesTagFilter(entry.name)) continue;

    fileEntries.push({
      name: entry.name,
      path: relativePath,
      extension,
      absolutePath: path.join(targetDir, entry.name),
    });
  }

  const files = await Promise.all(fileEntries.map(async (entry) => {
    const fileStat = await stat(entry.absolutePath);
    return {
      name: entry.name,
      path: entry.path,
      extension: entry.extension,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    } satisfies FileEntry;
  }));

  return { directories, files, extensions: [...extensions].sort(), availableTags: [...availableTags].sort(), tagIndexMap };
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
