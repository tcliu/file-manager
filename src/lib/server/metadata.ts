import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { METADATA_FILE } from './constants';
import { resolveListedDirectoryPath } from './file-utils';

export interface TagsMap {
  [tag: string]: string[];
}

export interface Metadata {
  tags?: TagsMap;
  tagIndexMap?: Record<string, number>;
}

export function getMetadataPath(relativeDir: string): string {
  const dirPath = resolveListedDirectoryPath(relativeDir);
  return path.join(dirPath, METADATA_FILE);
}

export async function readMetadata(relativeDir: string): Promise<Metadata> {
  const filePath = getMetadataPath(relativeDir);
  try {
    const content = await readFile(filePath, 'utf8');
    const data = yaml.load(content) as Metadata | null;
    return data ?? {};
  } catch {
    return {};
  }
}

export async function writeMetadata(relativeDir: string, data: Metadata): Promise<void> {
  const filePath = getMetadataPath(relativeDir);
  const yamlStr = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: true });
  await writeFile(filePath, yamlStr, 'utf8');
}

export async function getItemTags(relativeDir: string, filename: string): Promise<string[]> {
  const metadata = await readMetadata(relativeDir);
  if (!metadata.tags) return [];
  const result: string[] = [];
  for (const [tag, filenames] of Object.entries(metadata.tags)) {
    if (filenames.includes(filename)) {
      result.push(tag);
    }
  }
  return result.sort();
}

export async function setItemTags(relativeDir: string, filename: string, tags: string[]): Promise<void> {
  const metadata = await readMetadata(relativeDir);
  if (!metadata.tags) metadata.tags = {};

  const filtered = tags.filter(Boolean);

  for (const filenames of Object.values(metadata.tags)) {
    const idx = filenames.indexOf(filename);
    if (idx !== -1) filenames.splice(idx, 1);
  }

  for (const tag of filtered) {
    if (!metadata.tags[tag]) metadata.tags[tag] = [];
    if (!metadata.tags[tag].includes(filename)) {
      metadata.tags[tag].push(filename);
    }
  }

  for (const tag of Object.keys(metadata.tags)) {
    if (metadata.tags[tag].length === 0) {
      delete metadata.tags[tag];
    }
  }

  if (Object.keys(metadata.tags).length === 0) {
    delete metadata.tags;
  }

  await writeMetadata(relativeDir, metadata);
}

export async function addItemTags(relativeDir: string, filename: string, newTags: string[]): Promise<string[]> {
  const metadata = await readMetadata(relativeDir);
  if (!metadata.tags) metadata.tags = {};
  if (!metadata.tagIndexMap) metadata.tagIndexMap = {};

  for (const tag of newTags) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    if (!metadata.tags[trimmed]) {
      metadata.tags[trimmed] = [];
      metadata.tagIndexMap[trimmed] = Object.keys(metadata.tagIndexMap).length;
    }
    if (!metadata.tags[trimmed].includes(filename)) {
      metadata.tags[trimmed].push(filename);
    }
  }

  await writeMetadata(relativeDir, metadata);
  return getItemTags(relativeDir, filename);
}

export async function removeItemTags(relativeDir: string, filename: string, tagsToRemove: string[]): Promise<string[]> {
  const metadata = await readMetadata(relativeDir);
  if (!metadata.tags) return [];

  for (const tag of tagsToRemove) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const filenames = metadata.tags[trimmed];
    if (filenames) {
      const idx = filenames.indexOf(filename);
      if (idx !== -1) filenames.splice(idx, 1);
      if (filenames.length === 0) delete metadata.tags[trimmed];
    }
  }

  if (Object.keys(metadata.tags).length === 0) {
    delete metadata.tags;
  }

  await writeMetadata(relativeDir, metadata);
  return getItemTags(relativeDir, filename);
}

export async function getAllTags(relativeDir: string): Promise<string[]> {
  const metadata = await readMetadata(relativeDir);
  return metadata.tags ? Object.keys(metadata.tags).sort() : [];
}
