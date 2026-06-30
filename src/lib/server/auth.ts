import { json } from '@sveltejs/kit';
import { getAppConfig } from './config';

export interface SessionRecord {
  username: string;
  token: string;
  lastActiveAt: number;
}

export function isAuthEnabled(): boolean {
  return getAppConfig().auth.enabled;
}

export function readSessionToken(request: Request, url?: URL): string {
  return request.headers.get('x-session-token') || url?.searchParams.get('token') || '';
}

export function getSessionByToken(token: string): SessionRecord | null {
  if (!token) return null;
  const appConfig = getAppConfig();
  const { sessionExpiryMs } = appConfig.auth;
  const session = globalThis.__fileManagerSessions?.get(token) ?? null;
  if (!session) return null;
  if (Date.now() - session.lastActiveAt > sessionExpiryMs) {
    globalThis.__fileManagerSessions?.delete(token);
    return null;
  }
  session.lastActiveAt = Date.now();
  return { username: session.username, token, lastActiveAt: session.lastActiveAt };
}

export function requireSession(request: Request, url?: URL): SessionRecord | null {
  if (!isAuthEnabled()) {
    return { username: '', token: '', lastActiveAt: 0 };
  }
  return getSessionByToken(readSessionToken(request, url));
}

export function createAuthRequiredJsonResponse() {
  return json({ error: 'Authentication required' }, { status: 401 });
}
