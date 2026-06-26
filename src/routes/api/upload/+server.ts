import { json } from '@sveltejs/kit';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveUploadDirectoryPath } from '$lib/server/file-utils';
import { getAppConfig } from '$lib/server/config';
import { saveMultipartFiles } from '$lib/server/upload';
import { logAccess } from '$lib/server/logging';

export const POST: RequestHandler = async ({ request, url }) => {
  const appConfig = getAppConfig();
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const destinationDir = resolveUploadDirectoryPath(currentDir);
  const overwriteExisting = url.searchParams.get('overwrite') === '1';

  let destinationStat = await stat(destinationDir).catch(() => null);
  if (!destinationStat?.isDirectory()) {
    await mkdir(destinationDir, { recursive: true });
    destinationStat = await stat(destinationDir).catch(() => null);
  }

  const contentType = request.headers.get('content-type') ?? '';
  const boundaryMatch = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];

  if (!destinationStat?.isDirectory()) {
    return json({ error: 'Upload destination not found' }, { status: 400 });
  }

  if (!contentType.startsWith('multipart/form-data') || !boundary) {
    return json({ error: 'Expected multipart/form-data upload' }, { status: 400 });
  }

  const body = Buffer.from(await request.arrayBuffer());
  let uploaded: string[];
  const uploadLogEntries: { fileName: string; size: number }[] = [];

  try {
    uploaded = await saveMultipartFiles(body, boundary, destinationDir, {
      overwriteExisting,
      onFileSaved(file) {
        uploadLogEntries.push(file);
      },
    });
  } catch (error: any) {
    if (error.code === 'EFILEEXISTS') {
      return json({ error: error.message, suggestedName: error.suggestedName ?? '' }, { status: 409 });
    }
    throw error;
  }

  const uploadDirectory = normalizeRelativeDirectory(path.posix.join(currentDir, appConfig.uploadDir)) || appConfig.uploadDir;

  for (const file of uploadLogEntries) {
    logAccess(request as any, 'upload', {
      directory: currentDir || '.',
      path: normalizeRelativeDirectory(path.posix.join(uploadDirectory, file.fileName)),
      upload_directory: uploadDirectory, size: file.size, overwrite_existing: overwriteExisting,
    });
  }

  return json({ uploaded });
};
