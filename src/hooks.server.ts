import type { Handle } from '@sveltejs/kit';
import { getAppConfig } from '$lib/server/config';

export const handle: Handle = async ({ event, resolve }) => {
  const appConfig = getAppConfig();
  const url = new URL(event.request.url);
  const path = url.pathname;

  const publicPaths = ['/', '/api/login', '/api/logout', '/api/zip-download'];

  if (appConfig.auth.enabled && !publicPaths.includes(path)) {
    const token = event.request.headers.get('x-session-token')
      || url.searchParams.get('token')
      || '';

    if (!token) {
      if (path.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      }

      return new Response('Authentication required', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    const sessions = globalThis.__fileManagerSessions;
    const session = sessions?.get(token);

    if (!session || Date.now() >= session.expiresAt) {
      sessions?.delete(token);

      if (path.startsWith('/api/')) {
        return new Response(JSON.stringify({ error: 'Authentication required' }), {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8' }
        });
      }

      return new Response('Authentication required', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    event.locals.session = { username: session.username, token, expiresAt: session.expiresAt };
  }

  return resolve(event);
};
