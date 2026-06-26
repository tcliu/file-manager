import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, normalizeUploadFileName, resolveUploadDirectoryPath, fileExists, suggestAvailableFileName } from '$lib/server/file-utils';
import { stat } from 'node:fs/promises';
import path from 'node:path';

export const GET: RequestHandler = async ({ url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const requestedName = normalizeUploadFileName(url.searchParams.get('name') ?? '');
  const destinationDir = resolveUploadDirectoryPath(currentDir);
  const destinationStat = await stat(destinationDir).catch(() => null);

  if (!destinationStat?.isDirectory()) {
    return json({ exists: false, suggestedName: requestedName });
  }

  const targetPath = path.join(destinationDir, requestedName);
  const exists = await fileExists(targetPath);

  return json({
    exists,
    suggestedName: exists ? await suggestAvailableFileName(destinationDir, requestedName) : requestedName,
  });
};
