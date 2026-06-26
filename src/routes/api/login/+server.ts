import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/config';
import { logAccess } from '$lib/server/logging';

if (!globalThis.__fileManagerSessions) {
  globalThis.__fileManagerSessions = new Map();
}

export const POST: RequestHandler = async ({ request }) => {
  const appConfig = getAppConfig();

  if (!appConfig.auth.enabled) {
    logAccess(request as any, 'login', { username: '', auth_enabled: false, result: 'bypass' });
    return json({ ok: true, token: '', expiresInMs: 0 });
  }

  const body = await request.json().catch(() => ({}));
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (username !== appConfig.auth.username || password !== appConfig.auth.password) {
    logAccess(request as any, 'login_failed', {
      username, auth_enabled: true, reason: 'invalid_credentials',
    });
    return json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const token = randomUUID();
  globalThis.__fileManagerSessions!.set(token, {
    username,
    expiresAt: Date.now() + appConfig.auth.sessionExpiryMs,
  });

  logAccess(request as any, 'login', {
    username, auth_enabled: true, expires_in_ms: appConfig.auth.sessionExpiryMs,
  });

  return json({ ok: true, token, expiresInMs: appConfig.auth.sessionExpiryMs });
};
