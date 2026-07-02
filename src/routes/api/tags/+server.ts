import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory } from '$lib/server/file-utils';
import { createAuthRequiredJsonResponse, requireSession } from '$lib/server/auth';
import { readMetadata, addItemTags, removeItemTags } from '$lib/server/metadata';
import { logAccess } from '$lib/server/logging';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!requireSession(request, url)) {
    return createAuthRequiredJsonResponse();
  }

  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const metadata = await readMetadata(currentDir);
  return json({ tags: metadata.tags ?? {} });
};

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;
  if (!requireSession(request, url)) {
    return createAuthRequiredJsonResponse();
  }

  const startedAt = Date.now();
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const body = await request.json().catch(() => ({}));
  const action: string = body.action ?? '';
  const items: string[] = Array.isArray(body.items) ? body.items : [];
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map((t: string) => t.trim()).filter(Boolean) : [];

  if (!items.length || !tags.length) {
    return json({ error: 'items and tags are required' }, { status: 400 });
  }

  if (action !== 'add' && action !== 'remove') {
    return json({ error: 'action must be "add" or "remove"' }, { status: 400 });
  }

  const result: Record<string, string[]> = {};

  for (const item of items) {
    const filename = item.split('/').pop() ?? item;
    if (action === 'add') {
      result[item] = await addItemTags(currentDir, filename, tags);
    } else {
      result[item] = await removeItemTags(currentDir, filename, tags);
    }
  }

  logAccess(event, 'tags_update', {
    directory: currentDir,
    action,
    items,
    tags,
    elapsed_ms: Date.now() - startedAt,
  });

  return json({ tags: result });
};
