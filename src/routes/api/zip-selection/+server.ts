import { error } from '@sveltejs/kit';
import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath, formatTimestamp } from '$lib/server/file-utils';
import { createZipArchive } from '$lib/server/archive';
import { logAccess } from '$lib/server/logging';
import { getPendingZipDownloads } from '$lib/server/pending-downloads';
import {
  getImageArchiveExtension,
  getProcessedImageDimensions,
  isSharpProcessableImage,
  normalizeImageProcessOptions,
  processImageFile,
} from '$lib/server/image-processing';

interface FileItem {
  sourcePath: string;
  archivePath: string;
}

async function collectFiles(dir: string, items: string[], folderName?: string): Promise<FileItem[]> {
  const files: FileItem[] = [];
  async function walk(currentPath: string, archiveBase: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const archivePath = archiveBase + '/' + entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, archivePath);
      } else if (entry.isFile()) {
        files.push({ sourcePath: fullPath, archivePath });
      }
    }
  }
  for (const item of items) {
    const sourcePath = path.join(dir, item);
    const statResult = await stat(sourcePath).catch(() => null);
    if (!statResult) continue;
    if (statResult.isDirectory()) {
      await walk(sourcePath, folderName ? folderName + '/' + item : item);
    } else {
      files.push({ sourcePath, archivePath: folderName ? folderName + '/' + item : item });
    }
  }
  return files;
}

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const requestedItems: string[] = Array.isArray(body.items) ? body.items : [];
  const requestedFilename: string | undefined = typeof body.filename === 'string' ? body.filename.trim() : undefined;
  const requestedFolderName: string | undefined = typeof body.folderName === 'string' ? body.folderName.trim() : undefined;
  const imageOptions = normalizeImageProcessOptions(body as Record<string, unknown>);

  if (!directoryStat?.isDirectory()) {
    return error(400, { message: 'Current directory not found' });
  }

  if (requestedItems.length === 0) {
    return error(400, { message: 'No items selected' });
  }

  const selectedItems: string[] = [];

  for (const relativePath of requestedItems) {
    const entryPath = resolveCurrentDirectoryEntryPath(currentDir, relativePath);
    const entryStat = await stat(entryPath).catch(() => null);

    if (!entryStat || (!entryStat.isFile() && !entryStat.isDirectory())) {
      return error(400, { message: `Not a zippable item in this directory: ${relativePath}` });
    }

    selectedItems.push(path.relative(currentDirectoryPath, entryPath).split(path.sep).join('/'));
  }

  const startedAt = Date.now();

  logAccess(event, 'zip_start', {
    items: selectedItems,
    resize_width: imageOptions?.resizeWidth,
    resize_height: imageOptions?.resizeHeight,
    rotation: imageOptions?.rotation ?? 0,
    resize_quality: imageOptions?.resizeQuality,
    image_format: imageOptions?.imageFormat,
  });

  const archiveName = `${formatTimestamp(new Date())}.zip`;
  const displayName = requestedFilename && requestedFilename.endsWith('.zip')
    ? requestedFilename
    : (requestedFilename ? requestedFilename + '.zip' : archiveName);

  let resizeAllFiles: FileItem[] | undefined;

  if (imageOptions) {
    resizeAllFiles = await collectFiles(currentDirectoryPath, selectedItems, requestedFolderName);
  }

  const zipToken = randomUUID();
  const zipPath = path.join(tmpdir(), `file-manager-zip-${zipToken}.zip`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let resizeCleanupDir: string | undefined;

      try {
        function sendProgress(percent: number) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ p: percent }) + '\n'));
        }

        if (resizeAllFiles && imageOptions) {
          const resizeDir = await mkdtemp(path.join(tmpdir(), 'file-manager-resize-'));
          resizeCleanupDir = resizeDir;

          await new Promise<void>((resolve, reject) => {
            const output = createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            output.on('close', resolve);
            output.on('error', reject);
            archive.on('error', reject);

            archive.on('progress', (p) => {
              const pct = p.entries.total > 0
                ? Math.min(100, Math.round((p.entries.processed / p.entries.total) * 100))
                : 100;
              sendProgress(pct);
            });

            archive.pipe(output);

            (async () => {
              for (const file of resizeAllFiles) {
                const ext = path.extname(file.sourcePath).slice(1).toLowerCase();
                const isImage = isSharpProcessableImage(file.sourcePath);

                if (isImage) {
                  const processedDimensions = await getProcessedImageDimensions(file.sourcePath, imageOptions);
                  const needsResize = processedDimensions.width !== imageOptions.resizeWidth
                    || processedDimensions.height !== imageOptions.resizeHeight;
                  const needsRotation = imageOptions.rotation !== 0;
                  const originalFormat = ext.startsWith('jp') ? 'jpeg' : ext;
                  const formatChanged = originalFormat !== imageOptions.imageFormat;

                  if (!needsResize && !needsRotation && imageOptions.resizeQuality >= 100 && !formatChanged) {
                    archive.file(file.sourcePath, { name: file.archivePath });
                  } else {
                    const archiveExt = getImageArchiveExtension(imageOptions.imageFormat);
                    const nameInArchive = file.archivePath.replace(/\.[^/.]+$/, '') + '.' + archiveExt;
                    const resizedPath = path.join(
                      resizeDir,
                      file.archivePath.replace(/\.[^/.]+$/, '') + '.' + archiveExt,
                    );
                    await processImageFile(file.sourcePath, resizedPath, imageOptions);
                    archive.file(resizedPath, { name: nameInArchive });
                  }
                } else {
                  archive.file(file.sourcePath, { name: file.archivePath });
                }
              }
              await archive.finalize();
            })().catch(reject);
          });
        } else {
          await createZipArchive(
            currentDirectoryPath,
            zipPath,
            selectedItems,
            requestedFolderName,
            (processed, total) => {
              const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;
              sendProgress(pct);
            },
          );
        }

        const zipStat = await stat(zipPath);
        const expiresAt = Date.now() + 3600000;

        logAccess(event, 'zip_complete', {
          archive_size: zipStat.size,
          display_name: displayName,
        });

        getPendingZipDownloads().set(zipToken, {
          path: zipPath, filename: displayName, expiresAt,
        });

        controller.enqueue(new TextEncoder().encode(JSON.stringify({
          done: true, token: zipToken, size: zipStat.size, filename: displayName,
        }) + '\n'));
        controller.close();
      } catch (err) {
        await rm(zipPath, { force: true }).catch(() => {});
        logAccess(event, 'zip_error', {
          error: err instanceof Error ? err.message : String(err),
        });
        controller.error(err);
      } finally {
        if (resizeCleanupDir) rm(resizeCleanupDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  });

  return new Response(stream as any, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });
};
