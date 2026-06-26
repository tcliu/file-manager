import path from 'node:path';
import { readFileSync } from 'node:fs';
import { DEFAULT_UPLOAD_DIR, IMAGE_EXTENSIONS, RAW_IMAGE_EXTENSIONS } from './constants';
import { getSharpInputExtensions } from './image';

const SHARP_INPUT_EXTENSIONS = getSharpInputExtensions();

export const THUMBNAIL_SUPPORTED_EXTENSIONS = new Set([...SHARP_INPUT_EXTENSIONS, ...RAW_IMAGE_EXTENSIONS]);
export const THUMBNAIL_UNSUPPORTED_EXTENSIONS = [...IMAGE_EXTENSIONS]
  .filter((extension) => !THUMBNAIL_SUPPORTED_EXTENSIONS.has(extension));

export interface AuthConfig {
  enabled: boolean;
  sessionExpiryMs: number;
  username: string;
  password: string;
}

export interface AppConfig {
  auth: AuthConfig;
  uploadDir: string;
}

let cachedConfig: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadAppConfigSync();
  }
  return cachedConfig;
}

export function invalidateAppConfig(): void {
  cachedConfig = null;
}

function loadAppConfigSync(): AppConfig {
  const entries = loadEnvEntries();
  const rootDir = getRootDir();

  let rootDirs: string[] = [];
  if (entries['root-dir']) {
    const parts = entries['root-dir'].split(',').map(d => d.trim()).filter(Boolean);
    rootDirs = parts.map(d => path.resolve(rootDir, d));
  } else {
    rootDirs = [rootDir];
  }

  if (rootDirs.length > 1) {
    const basenames = rootDirs.map(d => path.basename(d));
    const unique = new Set(basenames);
    if (unique.size !== basenames.length) {
      throw new Error('Duplicate directory names not allowed when using multiple root directories');
    }
  }

  const username = entries['username'] ?? entries['user-name'] ?? '';
  const password = entries.password ?? '';
  const sessionExpiryMs = parseSessionExpiryMs(entries['session-expiry-ms']);

  if (password && !username) {
    throw new Error('Username must be set when password is configured in .env or .env.local');
  }

  const uploadDir = normalizeConfiguredDir(entries['upload-dir'], DEFAULT_UPLOAD_DIR, rootDirs, rootDirs.length > 1 ? rootDirs[0] : rootDir);

  return {
    auth: { enabled: password !== '', sessionExpiryMs, username, password },
    uploadDir,
  };
}

function getRootDir(): string {
  const configuredDir = process.env['FILE_MANAGER_ROOT_DIR'] || process.cwd();
  return path.resolve(configuredDir);
}

export function getRootDirs(): string[] {
  const rootDir = getRootDir();
  const entries = loadEnvEntries();

  if (entries['root-dir']) {
    const parts = entries['root-dir'].split(',').map(d => d.trim()).filter(Boolean);
    return parts.map(d => path.resolve(rootDir, d));
  }

  return [rootDir];
}

export function getRootDirPath(): string {
  const dirs = getRootDirs();
  return dirs[0];
}

function loadEnvEntries(): Record<string, string> {
  const mergedEntries: Record<string, string> = {};
  const baseDir = getRootDir();

  for (const fileName of ['.env', '.env.local']) {
    try {
      const content = readFileSync(path.join(baseDir, fileName), 'utf8');
      Object.assign(mergedEntries, parseEnvFile(content));
    } catch {
      // file doesn't exist, skip
    }
  }

  return mergedEntries;
}

function parseEnvFile(content: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function parseSessionExpiryMs(value: string | undefined): number {
  const sessionExpiryMs = Number(value);
  if (!Number.isInteger(sessionExpiryMs) || sessionExpiryMs <= 0) {
    return 3600000; // default 1 hour
  }
  return sessionExpiryMs;
}

function normalizeConfiguredDir(value: string | undefined, fallback: string, rootDirs: string[], rootDir: string): string {
  const rawValue = typeof value === 'string' && value.trim() ? value.trim() : fallback;

  if (rootDirs.length > 1) {
    for (const dir of rootDirs) {
      const resolvedPath = path.resolve(dir, rawValue);
      const relativePath = path.relative(dir, resolvedPath);
      if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return rawValue;
      }
    }
    throw new Error(`Configured directory must stay within a root directory: ${rawValue}`);
  }

  const resolvedPath = path.resolve(rootDir, rawValue);
  const relativePath = path.relative(rootDir, resolvedPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Configured directory must stay within root directory: ${rawValue}`);
  }

  return relativePath.split(path.sep).join('/');
}
