import { json } from '@sveltejs/kit';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath } from '$lib/server/file-utils';
import { getAppConfig } from '$lib/server/config';

async function computeItemSize(entryPath: string): Promise<number> {
  const entryStat = await stat(entryPath).catch(() => null);
  if (!entryStat) return 0;
  if (entryStat.isFile()) return entryStat.size;
  if (!entryStat.isDirectory()) return 0;

  let total = 0;
  const entries = await readdir(entryPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    total += await computeItemSize(path.join(entryPath, entry.name));
  }
  return total;
}

function requireSession(request: Request): boolean {
  const appConfig = getAppConfig();
  if (!appConfig.auth.enabled) return true;
  const token = request.headers.get('x-session-token') || '';
  if (!token) return false;
  const session = (globalThis as any).__fileManagerSessions?.get(token);
  return !!session;
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!requireSession(request)) {
    return json({ error: 'Authentication required' }, { status: 401 });
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);

  if (!directoryStat?.isDirectory()) {
    return json({ totalSize: 0 });
  }

  const body = await request.json().catch(() => ({}));
  const requestedItems: string[] = Array.isArray(body.items) ? body.items : [];

  let totalSize = 0;
  for (const relativePath of requestedItems) {
    try {
      const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
      totalSize += await computeItemSize(entryPath);
    } catch {
      continue;
    }
  }

  return json({ totalSize });
};
