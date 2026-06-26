import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getProcessedVideoPath, getVideoThumbnailPath } from './file-utils';
import { logEvent } from './logging';
import { getRootDirPath } from './config';
import { THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT, VIDEO_THUMBNAIL_QUALITY } from './constants';
import { extractFfmpegErrorDetail } from './image';

const activeVideoConversions = new Map<string, Promise<{ path: string; stat: import('node:fs').Stats; generated: boolean }>>();
const videoConversionStatuses = new Map<string, {
  state: string;
  progress: number;
  message: string;
  durationSeconds: number | null;
  updatedAt: number;
}>();

export interface VideoPreparationStatus {
  ready: boolean;
  requiresConversion: boolean;
  progress: number;
  message: string;
  error: string;
}

export async function getVideoPreparationStatus(filePath: string, fileStat: import('node:fs').Stats): Promise<VideoPreparationStatus> {
  const { VIDEO_EXTENSIONS } = await import('./constants');
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (!VIDEO_EXTENSIONS.has(extension) || extension === 'webm') {
    return { ready: true, requiresConversion: false, progress: 100, message: 'Video ready', error: '' };
  }

  const processedPath = getProcessedVideoPath(filePath);
  const processedStat = await stat(processedPath).catch(() => null);

  if (processedStat?.isFile() && processedStat.mtimeMs >= fileStat.mtimeMs) {
    return { ready: true, requiresConversion: true, progress: 100, message: 'Video ready', error: '' };
  }

  if (!activeVideoConversions.has(processedPath)) {
    const conversion = createProcessedVideo(filePath, processedPath)
      .finally(() => { activeVideoConversions.delete(processedPath); });
    activeVideoConversions.set(processedPath, conversion);
  }

  const status = videoConversionStatuses.get(processedPath);
  return {
    ready: false,
    requiresConversion: true,
    progress: status?.progress ?? 0,
    message: status?.message ?? 'Preparing video for browser playback...',
    error: status?.state === 'error' ? status.message : '',
  };
}

export async function resolveInlineMedia(filePath: string, fileStat: import('node:fs').Stats): Promise<{ path: string; stat: import('node:fs').Stats; generated: boolean }> {
  const { VIDEO_EXTENSIONS, RAW_IMAGE_EXTENSIONS } = await import('./constants');
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (RAW_IMAGE_EXTENSIONS.has(extension)) {
    const { ensureProcessedImage } = await import('./image');
    return ensureProcessedImage(filePath, fileStat);
  }

  if (!VIDEO_EXTENSIONS.has(extension) || extension === 'webm') {
    return { path: filePath, stat: fileStat, generated: false };
  }

  const processedPath = getProcessedVideoPath(filePath);
  const processedStat = await stat(processedPath).catch(() => null);

  if (processedStat?.isFile() && processedStat.mtimeMs >= fileStat.mtimeMs) {
    return { path: processedPath, stat: processedStat, generated: false };
  }

  const activeConversion = activeVideoConversions.get(processedPath);
  if (activeConversion) return activeConversion;

  const conversion = createProcessedVideo(filePath, processedPath)
    .finally(() => { activeVideoConversions.delete(processedPath); });
  activeVideoConversions.set(processedPath, conversion);
  return conversion;
}

async function createProcessedVideo(sourcePath: string, processedPath: string): Promise<{ path: string; stat: import('node:fs').Stats; generated: boolean }> {
  const rootDir = getRootDirPath();
  await mkdir(path.dirname(processedPath), { recursive: true });
  const tempPath = `${processedPath}.${randomUUID()}.tmp.mp4`;
  const durationSeconds = await probeVideoDurationSeconds(sourcePath);
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, processedPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'file_convert_start', { kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath });

  videoConversionStatuses.set(processedPath, {
    state: 'pending', progress: 0, message: 'Preparing video for browser playback...',
    durationSeconds, updatedAt: Date.now(),
  });

  try {
    await runFfmpegVideoConversion(sourcePath, tempPath, (progress) => {
      videoConversionStatuses.set(processedPath, {
        state: 'pending', progress,
        message: progress >= 100 ? 'Finalizing converted video...' : 'Preparing video for browser playback...',
        durationSeconds, updatedAt: Date.now(),
      });
    });
    await rename(tempPath, processedPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    logEvent('server', 'file_convert_error', {
      kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath,
      elapsed_ms: Date.now() - startedAt, error: (error as Error).message,
    });
    videoConversionStatuses.set(processedPath, {
      state: 'error', progress: 0, message: (error as Error).message,
      durationSeconds, updatedAt: Date.now(),
    });
    throw error;
  }

  videoConversionStatuses.set(processedPath, {
    state: 'ready', progress: 100, message: 'Video ready',
    durationSeconds, updatedAt: Date.now(),
  });

  logEvent('server', 'file_convert_end', {
    kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath,
    elapsed_ms: Date.now() - startedAt,
  });

  return { path: processedPath, stat: await stat(processedPath), generated: true };
}

function runFfmpegVideoConversion(sourcePath: string, targetPath: string, onProgress?: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', sourcePath, '-progress', 'pipe:2', '-nostats',
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k', targetPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let stderrBuffer = '';
    let durationSeconds: number | null = null;

    const reportProgress = (value: number) => onProgress?.(value);

    const handleProgressLine = (line: string) => {
      if (!line) return;
      const durationMatch = /^Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (durationMatch) {
        durationSeconds = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        return;
      }
      const [key, rawValue] = line.split('=', 2);
      if (!key || typeof rawValue === 'undefined') return;
      if ((key === 'out_time_us' || key === 'out_time_ms') && durationSeconds && durationSeconds > 0) {
        const currentSeconds = Number(rawValue) / 1000000;
        if (Number.isFinite(currentSeconds)) {
          reportProgress(Math.max(0, Math.min(99, Math.round((currentSeconds / durationSeconds) * 100))));
        }
        return;
      }
      if (key === 'progress' && rawValue === 'end') reportProgress(100);
    };

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) handleProgressLine(line.trim());
    });

    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new Error('ffmpeg is required to generate browser-playable video files.'));
      else reject(error);
    });

    child.on('exit', (code) => {
      if (stderrBuffer) handleProgressLine(stderrBuffer.trim());
      if (code === 0) { resolve(); return; }
      reject(new Error(extractFfmpegErrorDetail(stderr, code)));
    });
  });
}

function probeVideoDurationSeconds(sourcePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', () => resolve(null));
    child.on('exit', (code) => {
      if (code !== 0) { resolve(null); return; }
      const durationSeconds = Number(output.trim());
      resolve(Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null);
    });
  });
}

export async function ensureVideoThumbnail(sourcePath: string, sourceStat: import('node:fs').Stats): Promise<{ path: string; generated: boolean }> {
  const thumbnailPath = getVideoThumbnailPath(sourcePath);
  const thumbnailParentDir = path.dirname(thumbnailPath);
  const thumbnailStat = await stat(thumbnailPath).catch(() => null);

  if (thumbnailStat?.isFile() && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) {
    return { path: thumbnailPath, generated: false };
  }

  await mkdir(thumbnailParentDir, { recursive: true });
  await createVideoThumbnail(sourcePath, thumbnailPath);
  return { path: thumbnailPath, generated: true };
}

function createVideoThumbnail(sourcePath: string, thumbnailPath: string): Promise<void> {
  const rootDir = getRootDirPath();
  const sourceRelativePath = path.relative(rootDir, sourcePath).split(path.sep).join('/');
  const outputRelativePath = path.relative(rootDir, thumbnailPath).split(path.sep).join('/');
  const startedAt = Date.now();

  logEvent('server', 'thumbnail_generate_start', { kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath });

  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', sourcePath,
      '-vf', `thumbnail,scale=${THUMBNAIL_MAX_WIDTH}:${THUMBNAIL_MAX_HEIGHT}:force_original_aspect_ratio=decrease`,
      '-frames:v', '1', '-update', '1', '-q:v', String(VIDEO_THUMBNAIL_QUALITY), thumbnailPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') reject(new Error('ffmpeg is required to generate video thumbnails.'));
      else reject(error);
    });
    child.on('exit', (code) => {
      if (code !== 0) {
        const error = new Error(extractFfmpegErrorDetail(stderr, code));
        logEvent('server', 'thumbnail_generate_error', {
          kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath,
          elapsed_ms: Date.now() - startedAt, error: error.message,
        });
        reject(error);
        return;
      }
      logEvent('server', 'thumbnail_generate_end', {
        kind: 'video', source_path: sourceRelativePath, output_path: outputRelativePath,
        elapsed_ms: Date.now() - startedAt,
      });
      resolve();
    });
  });
}
