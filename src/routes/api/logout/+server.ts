import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createAuthRequiredJsonResponse,
  getSessionByToken,
  readSessionToken,
} from '$lib/server/auth';
import { getAppConfig } from '$lib/server/config';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async (event) => {
  const { request } = event;
  const appConfig = getAppConfig();

  if (!appConfig.auth.enabled) {
    logAccess(event, 'logout', { username: '', auth_enabled: false, result: 'bypass' });
    return json({ ok: true });
  }

  const token = readSessionToken(request);

  if (!token) {
    logAccess(event, 'logout_failed', {
      auth_enabled: true, reason: 'missing_session',
    });
    return createAuthRequiredJsonResponse();
  }

  const session = getSessionByToken(token);

  if (!session) {
    logAccess(event, 'logout_failed', {
      auth_enabled: true, reason: 'invalid_session',
    });
    return createAuthRequiredJsonResponse();
  }

  globalThis.__fileManagerSessions?.delete(token);

  logAccess(event, 'logout', {
    username: session.username, auth_enabled: true,
  });

  return json({ ok: true });
};
