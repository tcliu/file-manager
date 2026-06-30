import { error } from '@sveltejs/kit';
import { stat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import sharp from 'sharp';
import archiver from 'archiver';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath, formatTimestamp } from '$lib/server/file-utils';
import { createZipArchive } from '$lib/server/archive';
import { logAccess } from '$lib/server/logging';

function getSharpExtensions(): Set<string> {
  const exts = new Set<string>();
  for (const format of Object.values(sharp.format)) {
    if (!format.input?.file) continue;
    for (const suffix of format.input.fileSuffix ?? []) {
      exts.add(suffix.replace(/^\./, '').toLowerCase());
    }
  }
  return exts;
}

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

export const POST: RequestHandler = async ({ request, url }) => {
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const currentDirectoryPath = resolveListedDirectoryPath(currentDir);
  const directoryStat = await stat(currentDirectoryPath).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const requestedItems: string[] = Array.isArray(body.items) ? body.items : [];
  const requestedFilename: string | undefined = typeof body.filename === 'string' ? body.filename.trim() : undefined;
  const requestedFolderName: string | undefined = typeof body.folderName === 'string' ? body.folderName.trim() : undefined;
  const resizeWidth: number | undefined = typeof body.resizeWidth === 'number' ? Math.round(body.resizeWidth) : undefined;
  const resizeHeight: number | undefined = typeof body.resizeHeight === 'number' ? Math.round(body.resizeHeight) : undefined;
  const resizeQuality: number | undefined = typeof body.resizeQuality === 'number' ? Math.round(body.resizeQuality) : undefined;
  const imageFormat: string | undefined = typeof body.imageFormat === 'string' ? body.imageFormat.toLowerCase() : undefined;

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

  logAccess({ request }, 'zip_start', {
    items: selectedItems,
    resize_width: resizeWidth,
    resize_height: resizeHeight,
    resize_quality: resizeQuality,
    image_format: imageFormat,
  });

  const archiveName = `${formatTimestamp(new Date())}.zip`;
  const displayName = requestedFilename && requestedFilename.endsWith('.zip')
    ? requestedFilename
    : (requestedFilename ? requestedFilename + '.zip' : archiveName);

  let resizeAllFiles: FileItem[] | undefined;
  let sharpExtensions: Set<string> | undefined;

  if (resizeWidth && resizeHeight && resizeQuality) {
    sharpExtensions = getSharpExtensions();
    resizeAllFiles = await collectFiles(currentDirectoryPath, selectedItems, requestedFolderName);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let temporaryDir: string | undefined;
      let resizeCleanupDir: string | undefined;

      try {
        temporaryDir = await mkdtemp(path.join(tmpdir(), 'file-manager-zip-'));
        const zipPath = path.join(temporaryDir, archiveName);

        function sendProgress(percent: number) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ p: percent }) + '\n'));
        }

        if (resizeAllFiles && sharpExtensions) {
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
                const isImage = sharpExtensions!.has(ext);

                if (isImage) {
                  const meta = await sharp(file.sourcePath).metadata().catch(() => null);
                  let naturalW = meta?.width ?? 0;
                  let naturalH = meta?.height ?? 0;
                  if (meta?.orientation && meta.orientation >= 5) {
                    [naturalW, naturalH] = [naturalH, naturalW];
                  }
                  const needsResize = naturalW !== resizeWidth || naturalH !== resizeHeight;
                  const originalFormat = ext.startsWith('jp') ? 'jpeg' : ext;
                  const formatChanged = imageFormat && originalFormat !== imageFormat;

                  if (!needsResize && resizeQuality! >= 100 && !formatChanged) {
                    archive.file(file.sourcePath, { name: file.archivePath });
                  } else {
                    const archiveExt = imageFormat === 'png' ? 'png' : 'jpg';
                    const nameInArchive = file.archivePath.replace(/\.[^/.]+$/, '') + '.' + archiveExt;
                    const resizedName = path.basename(file.sourcePath).replace(/\.[^/.]+$/, '') + '.' + archiveExt;
                    const resizedPath = path.join(resizeDir, resizedName);
                    await mkdir(path.dirname(resizedPath), { recursive: true });
                    let pipeline = sharp(file.sourcePath).rotate();
                    if (needsResize) {
                      pipeline = pipeline.resize(resizeWidth!, resizeHeight!, { fit: 'fill' });
                    }
                    if (imageFormat === 'png') {
                      await pipeline.png().toFile(resizedPath);
                    } else {
                      await pipeline.jpeg({ quality: resizeQuality! }).toFile(resizedPath);
                    }
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

        logAccess({ request }, 'zip_complete', {
          archive_size: zipStat.size,
          display_name: displayName,
        });

        controller.enqueue(new TextEncoder().encode(JSON.stringify({ done: true, size: zipStat.size }) + '\n'));

        const readStream = createReadStream(zipPath);
        await new Promise<void>((resolve, reject) => {
          readStream.on('data', (chunk: Buffer | string) => {
            if (typeof chunk !== 'string') controller.enqueue(chunk);
          });
          readStream.on('end', resolve);
          readStream.on('error', reject);
        });

        controller.close();
      } catch (err) {
        logAccess({ request }, 'zip_error', {
          error: err instanceof Error ? err.message : String(err),
        });
        controller.error(err);
      } finally {
        if (temporaryDir) rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
        if (resizeCleanupDir) rm(resizeCleanupDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  });

  return new Response(stream as any, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${displayName}"`,
    },
  });
};
