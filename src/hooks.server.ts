import type { Handle } from '@sveltejs/kit';
import { createAuthRequiredJsonResponse, getSessionByToken, isAuthEnabled, readSessionToken } from '$lib/server/auth';
import { initFfmpeg, getFfmpegPath, getFfprobePath } from '$lib/server/ffmpeg-utils';

initFfmpeg().then(() => {
  console.log(`[ffmpeg] binary: ${getFfmpegPath()}`);
  console.log(`[ffprobe] binary: ${getFfprobePath()}`);
}).catch(() => {});

export const handle: Handle = async ({ event, resolve }) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  const publicPaths = ['/', '/api/login', '/api/logout', '/api/zip-download', '/api/process-image-download'];

  if (isAuthEnabled() && !publicPaths.includes(path)) {
    const token = readSessionToken(event.request, url);

    if (!token) {
      if (path.startsWith('/api/')) {
        return createAuthRequiredJsonResponse();
      }

      return new Response('Authentication required', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const session = getSessionByToken(token);

    if (!session) {

      if (path.startsWith('/api/')) {
        return createAuthRequiredJsonResponse();
      }

      return new Response('Authentication required', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    event.locals.session = { username: session.username, token, lastActiveAt: session.lastActiveAt };
  }

  return resolve(event);
};
