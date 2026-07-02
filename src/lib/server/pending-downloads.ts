import { rm } from 'node:fs/promises';

type PendingDownload = { path: string; filename: string; expiresAt: number };

function ensurePendingDownloadMap(key: '__pendingZipDownloads' | '__pendingProcessedDownloads') {
  if (!globalThis[key]) {
    globalThis[key] = new Map<string, PendingDownload>() as any;
    setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of globalThis[key]!) {
        if (now >= entry.expiresAt) {
          globalThis[key]!.delete(token);
          rm(entry.path, { force: true }).catch(() => {});
        }
      }
    }, 600000);
  }

  return globalThis[key]!;
}

export function getPendingZipDownloads() {
  return ensurePendingDownloadMap('__pendingZipDownloads');
}

export function getPendingProcessedDownloads() {
  return ensurePendingDownloadMap('__pendingProcessedDownloads');
}
