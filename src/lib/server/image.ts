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
const IMAGE_METADATA_CACHE_LIMIT = 1000;
const imageMetadataCache = new Map<string, { timestamp: string | null; width: number | null; height: number | null }>();

const EXIF_TAG_NUMBERS: Record<string, number> = {
  DateTime: 0x0132,
  ModifyDate: 0x0132,
  GPSInfoIFDPointer: 0x8825,
  ExifIFDPointer: 0x8769,
  DateTimeOriginal: 0x9003,
  CreateDate: 0x9004,
  OffsetTime: 0x9010,
  OffsetTimeOriginal: 0x9011,
  OffsetTimeDigitized: 0x9012,
  SubSecTime: 0x9290,
  SubSecTimeOriginal: 0x9291,
  SubSecTimeDigitized: 0x9292,
  TimeZoneOffset: 0x882a,
};

export function extractExifTagValue(exifBuffer: Buffer, tagNames: string[]): string | null {
  if (!Buffer.isBuffer(exifBuffer) || tagNames.length === 0) {
    return null;
  }

  const tiffOffset = exifBuffer.indexOf('Exif\0\0', 0, 'ascii');
  const start = tiffOffset === -1 ? 0 : tiffOffset + 6;

  if (exifBuffer.length < start + 8) {
    return null;
  }

  const byteOrder = exifBuffer.toString('ascii', start, start + 2);

  if (byteOrder !== 'II' && byteOrder !== 'MM') {
    return null;
  }

  const littleEndian = byteOrder === 'II';
  const readUInt16 = (offset: number) => littleEndian ? exifBuffer.readUInt16LE(offset) : exifBuffer.readUInt16BE(offset);
  const readUInt32 = (offset: number) => littleEndian ? exifBuffer.readUInt32LE(offset) : exifBuffer.readUInt32BE(offset);
  const asciiTags = new Set(tagNames.map((name) => EXIF_TAG_NUMBERS[name]).filter(Number.isInteger));

  if (!asciiTags.size) {
    return null;
  }

  const visitedIfds = new Set<number>();
  const queue = [start + readUInt32(start + 4)];

  while (queue.length > 0) {
    const ifdOffset = queue.shift()!;

    if (!Number.isInteger(ifdOffset) || ifdOffset < start || ifdOffset + 2 > exifBuffer.length || visitedIfds.has(ifdOffset)) {
      continue;
    }

    visitedIfds.add(ifdOffset);
    const entryCount = readUInt16(ifdOffset);

    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + (index * 12);

      if (entryOffset + 12 > exifBuffer.length) {
        break;
      }

      const tag = readUInt16(entryOffset);
      const type = readUInt16(entryOffset + 2);
      const count = readUInt32(entryOffset + 4);
      const valueOffset = entryOffset + 8;

      if (tag === EXIF_TAG_NUMBERS.ExifIFDPointer || tag === EXIF_TAG_NUMBERS.GPSInfoIFDPointer) {
        const nestedOffset = start + readUInt32(valueOffset);

        if (nestedOffset >= start && nestedOffset + 2 <= exifBuffer.length) {
          queue.push(nestedOffset);
        }
      }

      if (!asciiTags.has(tag) || type !== 2 || count === 0) {
        continue;
      }

      const byteLength = count;
      const dataOffset = byteLength <= 4 ? valueOffset : start + readUInt32(valueOffset);

      if (dataOffset < start || dataOffset + byteLength > exifBuffer.length) {
        continue;
      }

      const rawValue = exifBuffer.toString('utf8', dataOffset, dataOffset + byteLength).replace(/\0+$/u, '').trim();

      if (rawValue) {
        return rawValue;
      }
    }

    const nextIfdPointerOffset = ifdOffset + 2 + (entryCount * 12);

    if (nextIfdPointerOffset + 4 <= exifBuffer.length) {
      const nextIfdOffset = start + readUInt32(nextIfdPointerOffset);

      if (nextIfdOffset >= start && nextIfdOffset + 2 <= exifBuffer.length) {
        queue.push(nextIfdOffset);
      }
    }
  }

  return null;
}

export function normalizeExifOffset(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  if (/^[+-]\d{2}:\d{2}$/u.test(trimmed) || trimmed === 'Z') {
    return trimmed;
  }

  if (/^[+-]\d{4}$/u.test(trimmed)) {
    return `${trimmed.slice(0, 3)}:${trimmed.slice(3)}`;
  }

  if (/^[+-]?\d{1,2}$/u.test(trimmed)) {
    const hours = Math.abs(Number(trimmed));
    const sign = trimmed.startsWith('-') ? '-' : '+';
    return `${sign}${String(hours).padStart(2, '0')}:00`;
  }

  return '';
}

export function joinExifTimestampParts(timestamp: string | null, subsecond: string | null, offset: string | null): string | null {
  const trimmedTimestamp = typeof timestamp === 'string' ? timestamp.trim() : '';

  if (!trimmedTimestamp) {
    return null;
  }

  const trimmedSubsecond = typeof subsecond === 'string' ? subsecond.trim().replace(/\D+/gu, '') : '';
  const trimmedOffset = normalizeExifOffset(offset);
  return `${trimmedTimestamp}${trimmedSubsecond ? `.${trimmedSubsecond}` : ''}${trimmedOffset}`;
}

export function parseExifTimestamp(value: string | null): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const exifMatch = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/u.exec(trimmed);

  if (exifMatch) {
    const [, year, month, day, hours, minutes, seconds, fractional = '', offset = ''] = exifMatch;
    const parsed = new Date(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}${fractional ? `.${fractional}` : ''}${offset}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractImageTimestamp(metadata: { exif?: Buffer | null; dateTimeOriginal?: string | null; createDate?: string | null; modifyDate?: string | null; dateTime?: string | null }): string | null {
  const exifBuffer = metadata.exif;
  const exifTimestamp = extractExifTagValue(exifBuffer as Buffer, [
    'DateTimeOriginal',
    'CreateDate',
    'ModifyDate',
    'DateTime',
  ]);

  if (exifTimestamp) {
    const subsecond = extractExifTagValue(exifBuffer as Buffer, [
      'SubSecTimeOriginal',
      'SubSecTimeDigitized',
      'SubSecTime',
    ]);
    const offset = extractExifTagValue(exifBuffer as Buffer, [
      'OffsetTimeOriginal',
      'OffsetTimeDigitized',
      'OffsetTime',
      'TimeZoneOffset',
    ]);
    return joinExifTimestampParts(exifTimestamp, subsecond, offset);
  }

  return (metadata as any).dateTimeOriginal
    ?? (metadata as any).createDate
    ?? (metadata as any).modifyDate
    ?? (metadata as any).dateTime
    ?? null;
}

export async function readImageMetadata(filePath: string): Promise<{ timestamp: string | null; width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(filePath, { pages: 1 }).metadata();
    const candidate = extractImageTimestamp(metadata);
    const parsed = candidate ? parseExifTimestamp(candidate) : null;
    let w = Number.isFinite(metadata.width) ? metadata.width ?? null : null;
    let h = Number.isFinite(metadata.height) ? metadata.height ?? null : null;
    if (w && h && metadata.orientation && metadata.orientation >= 5) {
      [w, h] = [h, w];
    }
    return {
      timestamp: parsed ? parsed.toISOString() : null,
      width: w,
      height: h,
    };
  } catch {
    return { timestamp: null, width: null, height: null };
  }
}

export async function enrichImageMetadata(
  files: { extension: string; path: string; width?: number; height?: number; modifiedAt?: string }[],
  options?: { extractTimestamp?: boolean },
): Promise<void> {
  const { IMAGE_EXTENSIONS } = await import('./constants');

  await Promise.all(files.map(async (file) => {
    if (!IMAGE_EXTENSIONS.has(file.extension)) return;

    const cacheKey = `${file.path}|${file.modifiedAt ?? ''}`;
    let metadata = imageMetadataCache.get(cacheKey);

    if (!metadata) {
      metadata = await readImageMetadata(resolveListedFilePath(file.path));
      imageMetadataCache.set(cacheKey, metadata);
      if (imageMetadataCache.size > IMAGE_METADATA_CACHE_LIMIT) {
        imageMetadataCache.delete(imageMetadataCache.keys().next().value!);
      }
    }

    if (metadata.width && metadata.height) {
      file.width = metadata.width;
      file.height = metadata.height;
    }
    if (options?.extractTimestamp && metadata.timestamp) {
      (file as any).modifiedAt = metadata.timestamp;
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

  logEvent('server', 'file_convert_start', {
    kind: 'image', source_path: sourceRelativePath, output_path: outputRelativePath,
  });

  try {
    await convertImageToJpeg(sourcePath, tempPath);
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

async function convertImageToJpeg(sourcePath: string, targetPath: string): Promise<void> {
  const extension = path.extname(sourcePath).slice(1).toLowerCase();

  try {
    await runFfmpegImageConversion(sourcePath, targetPath);
  } catch (ffmpegError) {
    if (!RAW_IMAGE_EXTENSIONS.has(extension)) {
      throw ffmpegError;
    }

    await runImageMagickImageConversion(sourcePath, targetPath, (ffmpegError as Error).message);
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
    const child = spawn('convert', [
      sourcePath, '-auto-orient', '-quality', '92', targetPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`ffmpeg failed: ${ffmpegErrorMessage || 'unknown error'} | ImageMagick convert is not installed.`));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const convertDetail = extractFfmpegErrorDetail(stderr, code);
      reject(new Error(`ffmpeg failed: ${ffmpegErrorMessage || 'unknown error'} | ImageMagick failed: ${convertDetail}`));
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
