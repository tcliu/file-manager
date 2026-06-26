import { json } from '@sveltejs/kit';
import { stat, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath, isUploadSubtreePath, getProcessedImagePath, getProcessedVideoPath } from '$lib/server/file-utils';
import { RAW_IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '$lib/server/constants';

export const POST: RequestHandler = async ({ request, url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const requestedItems: string[] = Array.isArray(body.items) ? body.items : [];

  if (!directoryStat?.isDirectory()) {
    return json({ error: 'Current directory not found' }, { status: 400 });
  }

  if (requestedItems.length === 0) {
    return json({ error: 'No items selected' }, { status: 400 });
  }

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (entryStat?.isFile()) continue;
    if (entryStat?.isDirectory() && isUploadSubtreePath(currentDir, relativePath)) continue;
    if (entryStat?.isDirectory()) {
      return json({ error: `Directory deletion is only allowed under upload: ${relativePath}` }, { status: 400 });
    }
    return json({ error: `Not a deletable item in this directory: ${relativePath}` }, { status: 400 });
  }

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (entryStat?.isDirectory()) {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }

    await unlink(entryPath);
    const entryExtension = path.extname(entryPath).slice(1).toLowerCase();

    if (RAW_IMAGE_EXTENSIONS.has(entryExtension)) {
      await rm(getProcessedImagePath(entryPath), { force: true }).catch(() => {});
    }

    if (VIDEO_EXTENSIONS.has(entryExtension)) {
      await rm(getProcessedVideoPath(entryPath), { force: true }).catch(() => {});
    }
  }

  return json({ deleted: requestedItems });
};
