import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { IMAGE_EXTENSIONS } from '$lib/server/constants';
import { logAccess } from '$lib/server/logging';

export const GET: RequestHandler = async ({ url, request }) => {
  const relativePath = url.searchParams.get('path');

  if (!relativePath) {
    return new Response('Missing file path', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const filePath = resolveListedFilePath(relativePath);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat?.isFile()) {
    return new Response('File not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  const fileName = path.basename(filePath).replaceAll('"', '');
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (request.method === 'GET' && IMAGE_EXTENSIONS.has(extension)) {
    logAccess(request as any, 'download', { path: relativePath, size: fileStat.size });
  }

  if (request.method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(fileStat.size),
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  }

  const stream = createReadStream(filePath);
  const webStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(new Uint8Array(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(fileStat.size),
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  });
};

export const HEAD: RequestHandler = async ({ url, request }) => {
  return GET({ url, request, params: {}, route: { id: '/download' } } as any);
};
