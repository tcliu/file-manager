import type { ReadStream } from 'node:fs';

function toUint8Array(chunk: string | Buffer): Uint8Array {
  return new Uint8Array(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
}

export function createReadableStreamFromNode(stream: ReadStream, signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const cleanup = () => {
        stream.off('data', onData);
        stream.off('end', onEnd);
        stream.off('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      const destroy = () => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      };

      const onData = (chunk: string | Buffer) => {
        if (closed) return;

        try {
          controller.enqueue(toUint8Array(chunk));
        } catch {
          closed = true;
          cleanup();
          destroy();
        }
      };

      const onEnd = () => {
        close();
      };

      const onError = (err: Error) => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.error(err);
      };

      const onAbort = () => {
        if (closed) return;
        closed = true;
        cleanup();
        destroy();
      };

      stream.on('data', onData);
      stream.on('end', onEnd);
      stream.on('error', onError);

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener('abort', onAbort, { once: true });
      }
    },
    cancel() {
      if (!stream.destroyed) {
        stream.destroy();
      }
    },
  });
}
