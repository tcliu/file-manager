import { stat } from 'node:fs/promises';
import {
  isUploadSubtreePath,
  isWithinConfiguredUploadDir,
  normalizeRelativeDirectory,
  resolveCurrentDirectoryEntryPath,
  resolveListedDirectoryPath,
} from './file-utils';

export async function requireCurrentDirectory(relativeDir: string) {
  const currentDir = normalizeRelativeDirectory(relativeDir);
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  return {
    currentDir,
    currentDirectoryPath,
    directoryStat,
  };
}

export async function resolveCurrentDirectoryEntry(
  currentDir: string,
  relativePath: string,
) {
  const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
  const entryStat = await stat(entryPath).catch(() => null);
  return { entryPath, entryStat };
}

export function canCreateFolderInDirectory(currentDir: string): boolean {
  return isWithinConfiguredUploadDir(currentDir);
}

export function canDeleteDirectoryFromCurrentDir(
  currentDir: string,
  relativePath: string,
): boolean {
  return isUploadSubtreePath(currentDir, relativePath);
}
