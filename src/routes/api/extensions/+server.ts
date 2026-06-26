import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, listExtensions } from '$lib/server/file-utils';

export const GET: RequestHandler = async ({ url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const extensions = await listExtensions(resolveListedDirectoryPath(currentDir), currentDir);
  return json({ extensions });
};
