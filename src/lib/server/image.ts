import sharp from 'sharp';
import { THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, THUMBNAIL_QUALITY, RAW_IMAGE_EXTENSIONS } from './constants';
import { getImageThumbnailPath, getProcessedImagePath } from './file-utils';
import { logEvent } from './logging';
import path from 'node:path';
import { stat, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getRootDirPath } from './config';
import { spawn } from 'node:child_process';

export function getSharpInputExtensions(): Set<string> {
  const extensions = new Set<string>();
  for (const format of Object.values(sharp.format)) {
    if (!format.input?.file) continue;
    for (const suffix of format.input.fileSuffix ?? []) {
      extensions.add(suffix.replace(/^\./, '').toLowerCase());
    }
  }
  return extensions;
}

export const SHARP_INPUT_EXTENSIONS = getSharpInputExtensions();

const activeImageConversions = new Map<string, Promise<{ path: string; stat: import('node:fs').Stats; generated: boolean }>>();

export async function readImageMetadata(filePath: string): Promise<{ timestamp: string | null; width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(filePath, { pages: 1 }).metadata();
    return {
      timestamp: (metadata as any).dateTimeOriginal || (metadata as any).createDate || null,
      width: Number.isFinite(metadata.width) ? metadata.width ?? null : null,
      height: Number.isFinite(metadata.height) ? metadata.height ?? null : null,
    };
  } catch {
    return { timestamp: null, width: null, height: null };
  }
}

export async function enrichImageDimensions(files: { extension: string; path: string; width?: number; height?: number }[]): Promise<void> {
  const { IMAGE_EXTENSIONS } = await import('./constants');
  await Promise.all(files.map(async (file) => {
    if (!IMAGE_EXTENSIONS.has(file.extension)) return;
    const metadata = await readImageMetadata(resolveListedFilePath(file.path));
    if (metadata.width && metadata.height) {
      file.width = metadata.width;
      file.height = metadata.height;
    }
  }));
}

export async function enrichGridFileTimestamps(files: { extension: string; path: string; modifiedAt: string }[]): Promise<void> {
  const { IMAGE_EXTENSIONS } = await import('./constants');
  await Promise.all(files.map(async (file) => {
    if (!IMAGE_EXTENSIONS.has(file.extension)) return;
    const metadata = await readImageMetadata(resolveListedFilePath(file.path));
    if (metadata.timestamp) {
      file.modifiedAt = metadata.timestamp;
    }
  }));
}

import { resolveRootRelativePath } from './file-utils';

function resolveListedFilePath(relativePath: string): string {
  return resolveRootRelativePath(relativePath);
}

export interface ProcessedImageResult {
  path: string;
  stat: import('node:fs').Stats;
  generated: boolean;
}

export async function ensureProcessedImage(sourcePath: string, sourceStat: import('node:fs').Stats): Promise<ProcessedImageResult> {
  const processedPath = getProcessedImagePath(sourcePath);
  const processedParentDir = path.dirname(processedPath);
  const processedStat = await stat(processedPath).catch(() => null);

  if (processedStat?.isFile() && processedStat.mtimeMs >= sourceStat.mtimeMs) {
    return { path: processedPath, stat: processedStat, generated: false };
  }

  const activeConversion = activeImageConversions.get(processedPath);
  if (activeConversion) return activeConversion;

  await mkdir(processedParentDir, { recursive: true });
  const conversion = createProcessedImage(sourcePath, processedPath)
    .then(async () => ({
      path: processedPath,
      stat: await stat(processedPath),
      generated: true,
    }))
    .finally(() => {
      activeImageConversions.delete(processedPath);
    });

  activeImageConversions.set(processedPath, conversion);
  return conversion;
}

async function createProcessedImage(sourcePath: string, processedPath: string): Promise<void> {
  const rootDir = getRootDirPath();
  const tempPath = `${processedPath}.${randomUUID()}.tmp.jpg`;
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, processedPath).split(path.sep).join('/');
  const startedAt = Date.now();
  const extension = path.extname(sourcePath).slice(1).toLowerCase();

  logEvent('server', 'file_convert_start', {
    kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
  });

  try {
    await convertImageToJpeg(sourcePath, tempPath, extension);
    await rename(tempPath, processedPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    logEvent('server', 'file_convert_error', {
      kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
      elapsed_ms: Date.now() - startedAt, error: (error as Error).message,
    });
    throw error;
  }

  logEvent('server', 'file_convert_end', {
    kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
    elapsed_ms: Date.now() - startedAt,
  });
}

async function convertImageToJpeg(sourcePath: string, targetPath: string, extension: string): Promise<void> {
  try {
    await runFfmpegImageConversion(sourcePath, targetPath);
  } catch (error) {
    if (!RAW_IMAGE_EXTENSIONS.has(extension)) throw error;
    await runImageMagickImageConversion(sourcePath, targetPath, (error as Error).message);
  }
}

function runFfmpegImageConversion(sourcePath: string, targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', sourcePath, '-map', '0:v:0', '-frames:v', '1', '-update', '1', '-q:v', '2', targetPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new Error('ffmpeg is required to convert ARW files for browser preview.'));
      else reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(extractFfmpegErrorDetail(stderr, code)));
    });
  });
}

function runImageMagickImageConversion(sourcePath: string, targetPath: string, ffmpegErrorMessage = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('convert', [sourcePath, '-auto-orient', '-quality', '92', targetPath],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new Error(`ffmpeg failed: ${ffmpegErrorMessage || 'unknown error'} | ImageMagick convert is not installed.`));
      else reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed: ${ffmpegErrorMessage} | ImageMagick failed: ${extractFfmpegErrorDetail(stderr, code)}`));
    });
  });
}

export function extractFfmpegErrorDetail(stderr: string | undefined, code: number | null): string {
  const lines = String(stderr || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const meaningfulLines = lines.filter(l => l !== 'Conversion failed!');
  if (!meaningfulLines.length) return `ffmpeg exited with code ${code}`;
  return meaningfulLines.slice(-4).join(' | ');
}

export async function ensureImageThumbnail(sourcePath: string, sourceStat: import('node:fs').Stats): Promise<{ path: string; generated: boolean }> {
  const thumbnailPath = getImageThumbnailPath(sourcePath);
  const thumbnailParentDir = path.dirname(thumbnailPath);
  const thumbnailStat = await stat(thumbnailPath).catch(() => null);
  const extension = path.extname(sourcePath).slice(1).toLowerCase();

  if (thumbnailStat?.isFile() && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) {
    return { path: thumbnailPath, generated: false };
  }

  await mkdir(thumbnailParentDir, { recursive: true });
  const thumbnailInputPath = RAW_IMAGE_EXTENSIONS.has(extension)
    ? (await ensureProcessedImage(sourcePath, sourceStat)).path
    : sourcePath;
  await createImageThumbnail(thumbnailInputPath, thumbnailPath, sourcePath);
  return { path: thumbnailPath, generated: true };
}

async function createImageThumbnail(inputPath: string, thumbnailPath: string, sourcePath = inputPath): Promise<void> {
  const rootDir = getRootDirPath();
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, thumbnailPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'thumbnail_generate_start', { kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath });

  try {
    await sharp(inputPath, { pages: 1 })
      .rotate()
      .resize(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_QUALITY })
      .toFile(thumbnailPath);
  } catch (error) {
    logEvent('server', 'thumbnail_generate_error', {
      kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
      elapsed_ms: Date.now() - startedAt, error: (error as Error).message,
    });
    throw error;
  }

  logEvent('server', 'thumbnail_generate_end', {
    kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
    elapsed_ms: Date.now() - startedAt,
  });
}
