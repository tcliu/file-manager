import { json } from '@sveltejs/kit';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath } from '$lib/server/file-utils';
import { saveMultipartFiles } from '$lib/server/upload';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;
  const startedAt = Date.now();
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const destinationDir = resolveListedDirectoryPath(currentDir);
  const overwriteExisting = url.searchParams.get('overwrite') === '1';

  let destinationStat = await stat(destinationDir).catch(() => null);
  if (!destinationStat?.isDirectory()) {
    await mkdir(destinationDir, { recursive: true });
    destinationStat = await stat(destinationDir).catch(() => null);
  }

  const contentType = request.headers.get('content-type') ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];

  if (!destinationStat?.isDirectory()) {
    return json({ error: 'Upload destination not found' }, { status: 400 });
  }

  if (!contentType.startsWith('multipart/form-data') || !boundary) {
    return json({ error: 'Expected multipart/form-data upload' }, { status: 400 });
  }

  if (!request.body) {
    return json({ error: 'Missing upload body' }, { status: 400 });
  }

  let uploaded: string[];
  const uploadLogEntries: { fileName: string; size: number }[] = [];

  try {
    uploaded = await saveMultipartFiles(request.body, boundary, destinationDir, {
      overwriteExisting,
      onFileSaved(file) {
        uploadLogEntries.push(file);
      },
    });
  } catch (error: any) {
    if (error.code === 'EFILEEXISTS') {
      return json({ error: error.message, suggestedName: error.suggestedName ?? '' }, { status: 409 });
    }
    throw error;
  }

  const elapsedMs = Date.now() - startedAt;
  for (const file of uploadLogEntries) {
    logAccess(event, 'upload', {
      directory: currentDir || '.',
      path: normalizeRelativeDirectory(path.posix.join(currentDir, file.fileName)),
      size: file.size, overwrite_existing: overwriteExisting,
      elapsed_ms: elapsedMs,
    });
  }

  return json({ uploaded });
};
