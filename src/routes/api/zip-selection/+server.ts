import { error } from '@sveltejs/kit';
import { stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import sharp from 'sharp';
import archiver from 'archiver';
import type { RequestHandler } from './$types';
import { normalizeRelativeDirectory, resolveListedDirectoryPath, resolveCurrentDirectoryEntryPath, formatTimestamp } from '$lib/server/file-utils';
import { createZipArchive } from '$lib/server/archive';

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

  const archiveName = `${formatTimestamp(new Date())}.zip`;
  const displayName = requestedFilename && requestedFilename.endsWith('.zip')
    ? requestedFilename
    : (requestedFilename ? requestedFilename + '.zip' : archiveName);
  const temporaryDir = await mkdtemp(path.join(tmpdir(), 'file-manager-zip-'));
  const archivePath = path.join(temporaryDir, archiveName);

  let resizeCleanupDir: string | undefined;

  try {
    if (resizeWidth && resizeHeight && resizeQuality) {
      const sharpExtensions = getSharpExtensions();
      const resizeDir = await mkdtemp(path.join(tmpdir(), 'file-manager-resize-'));
      resizeCleanupDir = resizeDir;

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(archivePath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);

        (async () => {
          for (const item of selectedItems) {
            const sourcePath = path.join(currentDirectoryPath, item);
            const itemStat = await stat(sourcePath).catch(() => null);
            if (!itemStat) continue;
            const destPath = requestedFolderName ? requestedFolderName + '/' + item : item;

            if (itemStat.isDirectory()) {
              archive.directory(sourcePath, destPath);
            } else {
              const ext = path.extname(item).slice(1).toLowerCase();
              if (sharpExtensions.has(ext)) {
                const meta = await sharp(sourcePath).metadata().catch(() => null);
                let naturalW = meta?.width ?? 0;
                let naturalH = meta?.height ?? 0;
                if (meta?.orientation && meta.orientation >= 5) {
                  [naturalW, naturalH] = [naturalH, naturalW];
                }
                const needsResize = naturalW !== resizeWidth || naturalH !== resizeHeight;
                const originalFormat = ext.startsWith('jp') ? 'jpeg' : ext;
                const formatChanged = imageFormat && originalFormat !== imageFormat;
                if (!needsResize && resizeQuality >= 100 && !formatChanged) {
                  archive.file(sourcePath, { name: destPath });
                } else {
                  const archiveExt = imageFormat === 'png' ? 'png' : 'jpg';
                  const archiveName = destPath.replace(/\.[^/.]+$/, '') + '.' + archiveExt;
                  const resizedName = item.replace(/\.[^/.]+$/, '') + '.' + archiveExt;
                  const resizedPath = path.join(resizeDir, resizedName);
                  await mkdir(path.dirname(resizedPath), { recursive: true });
                  let pipeline = sharp(sourcePath).rotate();
                  if (needsResize) {
                    pipeline = pipeline.resize(resizeWidth, resizeHeight, { fit: 'fill' });
                  }
                  if (imageFormat === 'png') {
                    await pipeline.png().toFile(resizedPath);
                  } else {
                    await pipeline.jpeg({ quality: resizeQuality }).toFile(resizedPath);
                  }
                  archive.file(resizedPath, { name: archiveName });
                }
              } else {
                archive.file(sourcePath, { name: destPath });
              }
            }
          }
          await archive.finalize();
        })().catch(reject);
      });
    } else {
      await createZipArchive(currentDirectoryPath, archivePath, selectedItems, requestedFolderName);
    }

    const archiveStat = await stat(archivePath);

    const stream = createReadStream(archivePath);

    return new Response(stream as any, {
      status: 200,
      headers: {
        'content-type': 'application/zip',
        'content-length': String(archiveStat.size),
        'content-disposition': `attachment; filename="${displayName}"`,
      },
    });
  } finally {
    if (resizeCleanupDir) {
      rm(resizeCleanupDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};
