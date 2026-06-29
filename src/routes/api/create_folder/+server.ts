import { json } from '@sveltejs/kit';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import {
  isWithinConfiguredUploadDir,
  normalizeRelativeDirectory,
  normalizeUploadDirectoryName,
  resolveListedDirectoryPath,
} from '$lib/server/file-utils';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async ({ request, url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));

  if (!directoryStat?.isDirectory()) {
    return json({ error: 'Current directory not found' }, { status: 400 });
  }

  if (!isWithinConfiguredUploadDir(currentDir)) {
    return json({ error: 'Folder creation is only allowed under upload' }, { status: 400 });
  }

  let folderName = '';

  try {
    folderName = normalizeUploadDirectoryName(body.name ?? '');
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Invalid directory name' },
      { status: 400 },
    );
  }

  const targetPath = path.join(currentDirectoryPath, folderName);
  const targetStat = await stat(targetPath).catch(() => null);

  if (targetStat) {
    return json({ error: 'Folder already exists' }, { status: 409 });
  }

  await mkdir(targetPath, { recursive: false });

  logAccess(request as any, 'dir_create', {
    directory: currentDir,
    name: folderName,
  });

  return json({ created: normalizeRelativeDirectory(path.posix.join(currentDir, folderName)) });
};
