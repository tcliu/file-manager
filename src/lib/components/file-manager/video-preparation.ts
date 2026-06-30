export interface VideoPreparationEntry {
  ready: boolean;
  progress: number;
  message: string;
  error: string;
  requiresConversion?: boolean;
}

export function videoRequiresPreparation(
  extension: string,
  isVideoFile: (extension: string) => boolean,
): boolean {
  return isVideoFile(extension) && String(extension || '').toLowerCase() !== 'webm';
}

export function getDefaultVideoPreparationEntry(
  extension: string,
  isVideoFile: (extension: string) => boolean,
): VideoPreparationEntry {
  if (!isVideoFile(extension)) {
    return { ready: false, progress: 0, message: '', error: '' };
  }

  const requiresConversion = videoRequiresPreparation(extension, isVideoFile);
  return {
    ready: !requiresConversion,
    requiresConversion,
    progress: requiresConversion ? 0 : 100,
    message: requiresConversion ? 'Preparing video for browser playback...' : 'Video ready',
    error: '',
  };
}

export function getVideoPreparationProgress(entry: VideoPreparationEntry) {
  const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
  return {
    progress,
    label: entry.message || 'Preparing video for browser playback...',
    value: progress + '%',
    width: progress + '%',
    error: entry.error || '',
  };
}

export function normalizeVideoPreparationResponse(data: any): VideoPreparationEntry {
  return {
    ready: !!data.ready,
    requiresConversion: data.requiresConversion !== false,
    progress: Math.max(0, Math.min(100, Number(data.progress) || 0)),
    message:
      data.message ||
      (data.ready ? 'Video ready' : 'Preparing video for browser playback...'),
    error: data.error || '',
  };
}

export function createVideoPreparationErrorEntry(error: unknown): VideoPreparationEntry {
  return {
    ready: false,
    progress: 0,
    message: 'Preparing video for browser playback...',
    requiresConversion: true,
    error: error instanceof Error ? error.message : 'Failed to prepare video',
  };
}
