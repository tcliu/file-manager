import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/config';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async ({ request }) => {
  const appConfig = getAppConfig();

  if (!appConfig.auth.enabled) {
    logAccess(request as any, 'logout', { username: '', auth_enabled: false, result: 'bypass' });
    return json({ ok: true });
  }

  const token = request.headers.get('x-session-token') || '';

  if (!token) {
    logAccess(request as any, 'logout_failed', {
      auth_enabled: true, reason: 'missing_session',
    });
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const session = globalThis.__fileManagerSessions?.get(token);

  if (!session) {
    logAccess(request as any, 'logout_failed', {
      auth_enabled: true, reason: 'invalid_session',
    });
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  globalThis.__fileManagerSessions?.delete(token);

  logAccess(request as any, 'logout', {
    username: session.username, auth_enabled: true,
  });

  return json({ ok: true });
};
