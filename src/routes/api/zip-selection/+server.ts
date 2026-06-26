import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath, formatTimestamp } from '$lib/server/file-utils';
import { createZipArchive } from '$lib/server/archive';

export const POST: RequestHandler = async ({ request, url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const requestedItems: string[] = Array.isArray(body.items) ? body.items : [];

  if (!directoryStat?.isDirectory()) {
    return error(400, { message: 'Current directory not found' });
  }

  if (requestedItems.length === 0) {
    return error(400, { message: 'No items selected' });
  }

  const selectedItems: string[] = [];

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (!entryStat || (!entryStat.isFile() && !entryStat.isDirectory())) {
      return error(400, { message: `Not a zippable item in this directory: ${relativePath}` });
    }

    selectedItems.push(path.relative(currentDirectoryPath, entryPath).split(path.sep).join('/'));
  }

  const archiveName = `${formatTimestamp(new Date())}.zip`;
  const temporaryDir = await mkdtemp(path.join(tmpdir(), 'file-manager-zip-'));
  const archivePath = path.join(temporaryDir, archiveName);

  await createZipArchive(currentDirectoryPath, archivePath, selectedItems);
  const archiveStat = await stat(archivePath);

  const stream = createReadStream(archivePath);

  return new Response(stream as any, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-length': String(archiveStat.size),
      'content-disposition': `attachment; filename="${archiveName}"`,
    },
  });
};
