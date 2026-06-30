import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { resolveListedFilePath } from '$lib/server/file-utils';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, THUMBNAIL_SUPPORTED_EXTENSIONS, getInlineContentType, getContentDisposition, RAW_IMAGE_EXTENSIONS } from '$lib/server/constants';
import { ensureProcessedImage, ensureImageThumbnail } from '$lib/server/image';
import { ensureVideoThumbnail } from '$lib/server/video';
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

  let thumbnail: { path: string; generated: boolean };

  if (IMAGE_EXTENSIONS.has(extension)) {
    if (!THUMBNAIL_SUPPORTED_EXTENSIONS.has(extension)) {
      return new Response(`Thumbnail generation is not supported for .${extension} on this server`, {
        status: 415, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    try {
      thumbnail = RAW_IMAGE_EXTENSIONS.has(extension)
        ? await ensureProcessedImage(filePath, fileStat)
        : await ensureImageThumbnail(filePath, fileStat);
    } catch {
      return new Response(`Thumbnail generation failed for .${extension}`, {
        status: 415, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  } else if (VIDEO_EXTENSIONS.has(extension)) {
    thumbnail = await ensureVideoThumbnail(filePath, fileStat);
  } else {
    return new Response('Thumbnail is only available for image and video files', {
      status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const thumbnailStat = await stat(thumbnail.path);
  const contentType = getInlineContentType(thumbnail.path);
  const fileName = path.basename(thumbnail.path).replaceAll('"', '');

  const stream = createReadStream(thumbnail.path);
  const webStream = createReadableStreamFromNode(stream, request.signal);

  return new Response(webStream, {
    status: 200,
    headers: {
      'content-length': String(thumbnailStat.size),
      'content-type': contentType,
      'content-disposition': getContentDisposition(fileName, 'inline'),
    },
  });
};
