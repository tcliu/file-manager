import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { listZipArchiveContents } from '$lib/server/archive';
import { logAccess } from '$lib/server/logging';

export const GET: RequestHandler = async ({ url, request }) => {
  const startedAt = Date.now();
  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    logAccess(request as any, 'archive_view_failed', { path: '', reason: 'missing_file_path', elapsed_ms: Date.now() - startedAt });
    return json({ error: 'Missing file path' }, { status: 400 });
  }

  let filePath: string;

  try {
    filePath = resolveListedFilePath(relativePath);
  } catch (error) {
    logAccess(request as any, 'archive_view_failed', {
      path: relativePath, reason: 'invalid_file_path', error: (error as Error).message,
      elapsed_ms: Date.now() - startedAt,
    });
    return json({ error: (error as Error).message || 'Invalid file path' }, { status: 400 });
  }

  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    logAccess(request as any, 'archive_view_failed', { path: relativePath, reason: 'file_not_found', elapsed_ms: Date.now() - startedAt });
    return json({ error: 'File not found' }, { status: 404 });
  }

  if (path.extname(filePath).slice(1).toLowerCase() !== 'zip') {
    logAccess(request as any, 'archive_view_failed', {
      path: relativePath, size: fileStat.size, reason: 'unsupported_extension',
      elapsed_ms: Date.now() - startedAt,
    });
    return json({ error: 'Archive preview is only supported for .zip files' }, { status: 415 });
  }

  try {
    const archiveContents = await listZipArchiveContents(filePath);
    logAccess(request as any, 'archive_view', {
      path: relativePath, size: fileStat.size,
      directories: archiveContents.directories.length, files: archiveContents.files.length,
      elapsed_ms: Date.now() - startedAt,
    });
    return json(archiveContents);
  } catch (error) {
    logAccess(request as any, 'archive_view_failed', {
      path: relativePath, size: fileStat.size, reason: 'read_failed',
      error: (error as Error).message || 'Failed to read archive contents',
      elapsed_ms: Date.now() - startedAt,
    });
    return json({ error: (error as Error).message || 'Failed to read archive contents' }, { status: 500 });
  }
};
