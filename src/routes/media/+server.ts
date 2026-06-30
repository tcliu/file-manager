import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { getInlineContentType, getContentDisposition } from '$lib/server/constants';
import { IMAGE_EXTENSIONS } from '$lib/server/constants';
import { resolveInlineMedia } from '$lib/server/video';
import { logAccess } from '$lib/server/logging';
import { createReadableStreamFromNode } from '$lib/server/stream';

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

  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (request.method === 'GET' && IMAGE_EXTENSIONS.has(extension)) {
    logAccess(request as any, 'file_view', { path: relativePath, size: fileStat.size });
  }

  const inlineMedia = await resolveInlineMedia(filePath, fileStat);

  return streamInlineFile(request, inlineMedia.path, inlineMedia.stat);
};

export const HEAD: RequestHandler = async ({ url, request }) => {
  return GET({ url, request, params: {}, route: { id: '/media' } } as any);
};

async function streamInlineFile(request: Request, filePath: string, fileStat: import('node:fs').Stats): Promise<Response> {
  const contentType = getInlineContentType(filePath);
  const rangeHeader = request.headers.get('range');
  const fileName = path.basename(filePath).replaceAll('"', '');

  if (!rangeHeader) {
    const stream = createReadStream(filePath);
    const webStream = createReadableStreamFromNode(stream, request.signal);

    return new Response(webStream, {
      status: 200,
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(fileStat.size),
        'content-type': contentType,
        'content-disposition': getContentDisposition(fileName, 'inline'),
      },
    });
  }

  const rangeMatch = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader);
  if (!rangeMatch) {
    return new Response('Invalid range', {
      status: 416,
      headers: { 'content-range': `bytes */${fileStat.size}`, 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const start = rangeMatch[1] ? Number(rangeMatch[1]) : null;
  const end = rangeMatch[2] ? Number(rangeMatch[2]) : null;
  let rangeStart: number;
  let rangeEnd: number;

  if (start === null && end === null) {
    return new Response('Invalid range', {
      status: 416,
      headers: { 'content-range': `bytes */${fileStat.size}`, 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (start === null) {
    const suffixLength = end!;
    rangeStart = Math.max(0, fileStat.size - suffixLength);
    rangeEnd = fileStat.size - 1;
  } else {
    rangeStart = start;
    rangeEnd = end === null ? fileStat.size - 1 : end;
  }

  if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 0 || rangeEnd < rangeStart || rangeStart >= fileStat.size) {
    return new Response('Requested range not satisfiable', {
      status: 416,
      headers: { 'content-range': `bytes */${fileStat.size}`, 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  rangeEnd = Math.min(rangeEnd, fileStat.size - 1);
  const contentLength = rangeEnd - rangeStart + 1;

  const stream = createReadStream(filePath, { start: rangeStart, end: rangeEnd });
  const webStream = createReadableStreamFromNode(stream, request.signal);

  return new Response(webStream, {
    status: 206,
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(contentLength),
      'content-range': `bytes ${rangeStart}-${rangeEnd}/${fileStat.size}`,
      'content-type': contentType,
      'content-disposition': getContentDisposition(fileName, 'inline'),
    },
  });
}
