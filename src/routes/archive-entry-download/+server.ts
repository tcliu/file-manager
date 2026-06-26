import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { getInlineContentType } from '$lib/server/constants';
import { listZipArchiveContents, ensureZipArchiveEntryReadable, streamZipArchiveEntry } from '$lib/server/archive';
import { logAccess } from '$lib/server/logging';

function normalizeArchiveEntryPath(relativePath: string): string {
  const normalizedPath = path.posix.normalize('/' + String(relativePath || '')).replace(/^\//, '');
  if (normalizedPath === '.' || normalizedPath === '') return '';
  if (normalizedPath.startsWith('..')) return '';
  return normalizedPath;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const relativePath = url.searchParams.get('path');
  const entryPath = url.searchParams.get('entry');

  if (!relativePath || !entryPath) {
    return new Response('Missing archive path or entry path', {
      status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const archivePath = resolveListedFilePath(relativePath);
  const archiveStat = await stat(archivePath).catch(() => null);

  if (!archiveStat?.isFile()) {
    return new Response('Archive not found', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (path.extname(archivePath).slice(1).toLowerCase() !== 'zip') {
    return new Response('Archive entry download is only supported for .zip files', {
      status: 415, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const normalizedEntryPath = normalizeArchiveEntryPath(entryPath);

  if (!normalizedEntryPath) {
    return new Response('Invalid archive entry path', {
      status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const archiveContents = await listZipArchiveContents(archivePath);
  const archiveFile = archiveContents.files.find((file) => file.path === normalizedEntryPath);

  if (!archiveFile) {
    return new Response('Archive entry not found', {
      status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  try {
    await ensureZipArchiveEntryReadable(archivePath, normalizedEntryPath);
  } catch (error) {
    return new Response((error as Error).message || 'Failed to read archive entry', {
      status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const contentType = getInlineContentType(archiveFile.name);
  const fileName = archiveFile.name.replaceAll('"', '');

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': contentType,
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  }

  const webStream = new ReadableStream({
    start(controller) {
      const mockResponse = {
        write(chunk: Uint8Array) { controller.enqueue(chunk); return true; },
        end() { controller.close(); },
        on() {},
        get writableEnded() { return false; },
        get headersSent() { return false; },
        writeHead() {},
      };

      streamZipArchiveEntry(archivePath, normalizedEntryPath, mockResponse as any)
        .then(() => {
          if (!controller.desiredSize || controller.desiredSize <= 0) return;
          logAccess(request as any, 'archive_entry_download', {
            path: relativePath, entry: normalizedEntryPath, archive_size: archiveStat.size,
          });
        })
        .catch((error) => {
          controller.error(error);
        });
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  });
};
