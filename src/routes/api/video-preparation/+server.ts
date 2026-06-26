import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { stat } from 'node:fs/promises';
import { getVideoPreparationStatus } from '$lib/server/video';

export const GET: RequestHandler = async ({ url }) => {
  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    return json({ error: 'Missing file path' }, { status: 400 });
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    return json({ error: 'File not found' }, { status: 404 });
  }

  return json(await getVideoPreparationStatus(filePath, fileStat));
};
