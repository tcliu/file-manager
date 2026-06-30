const SESSION_STORAGE_KEY = 'file-manager-auth';

export interface ClientSession {
  username: string;
  token: string;
  lastActiveAt: number;
  sessionExpiryMs: number;
}

export function readSession(options: {
  authEnabled: boolean;
  authUsername: string;
  sessionExpiryMs: number;
}): ClientSession | null {
  if (!options.authEnabled) {
    return {
      username: options.authUsername || 'Guest',
      token: '',
      lastActiveAt: Date.now(),
      sessionExpiryMs: options.sessionExpiryMs,
    };
  }

  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (
      typeof session.lastActiveAt !== 'number' ||
      typeof session.token !== 'string' ||
      !session.token ||
      Date.now() - session.lastActiveAt > options.sessionExpiryMs
    ) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function writeSession(username: string, token: string, sessionExpiryMs: number): ClientSession {
  const session = {
    username,
    token,
    lastActiveAt: Date.now(),
    sessionExpiryMs,
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function touchSession(): void {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return;
  try {
    const session = JSON.parse(raw);
    if (typeof session.lastActiveAt === 'number' && typeof session.sessionExpiryMs === 'number') {
      session.lastActiveAt = Date.now();
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // ignore parse errors
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getAuthHeaders(session: ClientSession | null): Record<string, string> {
  if (!session) return {};
  return { 'x-session-token': session.token };
}

export function createTokenizedFileUrl(pathname: string, filePath: string, session: ClientSession | null, authEnabled: boolean): string {
  const query = new URLSearchParams({ path: filePath });
  if (authEnabled && session?.token) {
    query.set('token', session.token);
  }
  return `${pathname}?${query.toString()}`;
}
