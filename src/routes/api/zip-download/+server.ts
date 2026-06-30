import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { getContentDisposition } from '$lib/server/constants';

if (!globalThis.__pendingZipDownloads) {
  globalThis.__pendingZipDownloads = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of globalThis.__pendingZipDownloads!) {
      if (now >= entry.expiresAt) {
        globalThis.__pendingZipDownloads!.delete(key);
        rm(entry.path, { force: true }).catch(() => {});
      }
    }
  }, 600000);
}

function toUint8Array(chunk: string | Buffer): Uint8Array {
  return new Uint8Array(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
}

export const GET: RequestHandler = async ({ url, request }) => {
  const rawToken = url.searchParams.get('token');
  if (!rawToken) {
    return new Response('Missing token', { status: 400 });
  }
  const token: string = rawToken;

  if (!globalThis.__pendingZipDownloads) {
    return new Response('No pending downloads', { status: 404 });
  }

  const pendingEntry = globalThis.__pendingZipDownloads.get(token);
  if (!pendingEntry) {
    return new Response('Download not found or expired', { status: 404 });
  }

  if (Date.now() >= pendingEntry.expiresAt) {
    globalThis.__pendingZipDownloads.delete(token);
    await rm(pendingEntry.path, { force: true }).catch(() => {});
    return new Response('Download expired', { status: 410 });
  }

  const zipFilePath: string = pendingEntry.path;
  const zipFilename = pendingEntry.filename;

  const fileStat = await stat(zipFilePath).catch(() => null);
  if (!fileStat?.isFile()) {
    globalThis.__pendingZipDownloads.delete(token);
    return new Response('File not found', { status: 404 });
  }

  const nodeStream = createReadStream(zipFilePath);

  function cleanup() {
    globalThis.__pendingZipDownloads?.delete(token);
    rm(zipFilePath, { force: true }).catch(() => {});
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
      'content-type': 'application/zip',
      'content-disposition': getContentDisposition(zipFilename, 'attachment'),
      'content-length': String(fileStat.size),
    },
  });
};
