import { stat } from 'node:fs/promises';

let ffmpegPath: string = 'ffmpeg';
let ffprobePath: string = 'ffprobe';
let initialized = false;

async function tryStat(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

async function resolveFfmpegPath(): Promise<string> {
  try {
    const mod = await import('ffmpeg-static');
    const staticPath = (mod as { default: string | null }).default;
    if (staticPath && (await tryStat(staticPath))) {
      return staticPath;
    }
  } catch {
    // ffmpeg-static not installed or unavailable
  }
  return 'ffmpeg';
}

async function resolveFfprobePath(): Promise<string> {
  try {
    const mod = await import('@ffprobe-installer/ffprobe');
    const pkg = (mod as { default: { path: string } | undefined }).default;
    const probePath = pkg?.path ?? (mod as { path: string }).path;
    if (probePath && (await tryStat(probePath))) {
      return probePath;
    }
  } catch {
    // @ffprobe-installer/ffprobe not installed or unavailable
  }
  return 'ffprobe';
}

export async function initFfmpeg(): Promise<void> {
  if (initialized) return;
  ffmpegPath = await resolveFfmpegPath();
  ffprobePath = await resolveFfprobePath();
  initialized = true;
}

export function getFfmpegPath(): string {
  return ffmpegPath;
}

export function getFfprobePath(): string {
  return ffprobePath;
}
