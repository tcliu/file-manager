import { json } from '@sveltejs/kit';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import {
  normalizeRelativeDirectory,
  normalizeUploadDirectoryName,
  resolveListedDirectoryPath,
} from '$lib/server/file-utils';
import { canCreateFolderInDirectory } from '$lib/server/access-policy';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));

  if (!directoryStat?.isDirectory()) {
    return json({ error: 'Current directory not found' }, { status: 400 });
  }

  if (!canCreateFolderInDirectory(currentDir)) {
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

  logAccess(event, 'dir_create', {
    directory: currentDir,
    name: folderName,
  });

  return json({ created: normalizeRelativeDirectory(path.posix.join(currentDir, folderName)) });
};
