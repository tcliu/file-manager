import { stat, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { RequestHandler } from './$types';
import { getContentDisposition, getInlineContentType } from '$lib/server/constants';
import { getPendingProcessedDownloads } from '$lib/server/pending-downloads';

function toUint8Array(chunk: string | Buffer): Uint8Array {
  return new Uint8Array(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
}

export const GET: RequestHandler = async ({ url, request }) => {
  const rawToken = url.searchParams.get('token');
  if (!rawToken) {
    return new Response('Missing token', { status: 400 });
  }
  const token: string = rawToken;

  const pendingEntry = getPendingProcessedDownloads().get(token);
  if (!pendingEntry) {
    return new Response('Download not found or expired', { status: 404 });
  }
  const downloadEntry = pendingEntry;

  if (Date.now() >= downloadEntry.expiresAt) {
    getPendingProcessedDownloads().delete(token);
    await rm(downloadEntry.path, { force: true }).catch(() => {});
    return new Response('Download expired', { status: 410 });
  }

  const fileStat = await stat(downloadEntry.path).catch(() => null);
  if (!fileStat?.isFile()) {
    getPendingProcessedDownloads().delete(token);
    return new Response('File not found', { status: 404 });
  }

  const nodeStream = createReadStream(downloadEntry.path);

  function cleanup() {
    getPendingProcessedDownloads().delete(token);
    rm(downloadEntry.path, { force: true }).catch(() => {});
    if (!nodeStream.destroyed) nodeStream.destroy();
  }

  const webStream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const onData = (chunk: string | Buffer) => {
        if (closed) return;
        try {
          controller.enqueue(toUint8Array(chunk));
        } catch {
          closed = true;
          nodeStream.off('data', onData);
          nodeStream.off('end', onEnd);
          nodeStream.off('error', onError);
          cleanup();
        }
      };

      const onEnd = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      const onError = (err: Error) => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.error(err);
      };

      nodeStream.on('data', onData);
      nodeStream.on('end', onEnd);
      nodeStream.on('error', onError);

      if (request.signal) {
        if (request.signal.aborted) {
          cleanup();
          return;
        }
        request.signal.addEventListener('abort', cleanup, { once: true });
      }
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(webStream, {
    status: 200,
    headers: {
      'content-type': getInlineContentType(downloadEntry.filename),
      'content-disposition': getContentDisposition(downloadEntry.filename, 'attachment'),
      'content-length': String(fileStat.size),
    },
  });
};
