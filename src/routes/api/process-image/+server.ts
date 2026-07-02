import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveCurrentDirectoryEntryPath, resolveListedDirectoryPath } from '$lib/server/file-utils';
import { getPendingProcessedDownloads } from '$lib/server/pending-downloads';
import {
  getImageArchiveExtension,
  isSharpProcessableImage,
  normalizeImageProcessOptions,
  processImageFile,
} from '$lib/server/image-processing';

function buildProcessedFilename(
  requestedFilename: string | undefined,
  sourcePath: string,
  imageFormat: string,
): string {
  const archiveExt = getImageArchiveExtension(imageFormat);
  const sourceBaseName = path.basename(sourcePath).replace(/\.[^/.]+$/, '') || 'image';
  const safeRequestedName = path.basename((requestedFilename ?? '').trim());
  const outputBaseName = safeRequestedName.replace(/\.[^/.]+$/, '') || sourceBaseName;
  return `${outputBaseName}.${archiveExt}`;
}

export const POST: RequestHandler = async ({ request, url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const requestedItem = typeof body.item === 'string' ? body.item : '';
  const requestedFilename = typeof body.filename === 'string' ? body.filename : undefined;
  const imageOptions = normalizeImageProcessOptions(body as Record<string, unknown>);

  if (!directoryStat?.isDirectory()) {
    return error(400, { message: 'Current directory not found' });
  }

  if (!requestedItem) {
    return error(400, { message: 'No image selected' });
  }

  if (!imageOptions) {
    return error(400, { message: 'Invalid image options' });
  }

  const entryPath = resolveCurrentDirectoryEntryPath(currentDir, requestedItem);
  const entryStat = await stat(entryPath).catch(() => null);
  if (!entryStat?.isFile()) {
    return error(400, { message: 'Selected image not found' });
  }

  if (!isSharpProcessableImage(entryPath)) {
    return error(400, { message: 'Selected image format is not supported for processing' });
  }

  const outputFileName = buildProcessedFilename(
    requestedFilename,
    entryPath,
    imageOptions.imageFormat,
  );
  const archiveExt = getImageArchiveExtension(imageOptions.imageFormat);
  const outputPath = path.join(tmpdir(), `file-manager-process-${randomUUID()}.${archiveExt}`);
  await processImageFile(entryPath, outputPath, imageOptions);
  const outputStat = await stat(outputPath);

  const token = randomUUID();
  getPendingProcessedDownloads().set(token, {
    path: outputPath,
    filename: outputFileName,
    expiresAt: Date.now() + 3600000,
  });

  return Response.json({
    token,
    filename: outputFileName,
    size: outputStat.size,
  });
};
