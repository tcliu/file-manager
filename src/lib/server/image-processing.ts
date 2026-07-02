import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { SHARP_INPUT_EXTENSIONS } from './image';

export interface ImageProcessOptions {
  resizeWidth: number;
  resizeHeight: number;
  resizeQuality: number;
  imageFormat: string;
  rotation: number;
}

export function normalizeImageProcessOptions(body: Record<string, unknown>): ImageProcessOptions | null {
  const resizeWidth = typeof body.resizeWidth === 'number' ? Math.round(body.resizeWidth) : undefined;
  const resizeHeight = typeof body.resizeHeight === 'number' ? Math.round(body.resizeHeight) : undefined;
  const resizeQuality = typeof body.resizeQuality === 'number' ? Math.round(body.resizeQuality) : undefined;
  const imageFormat = typeof body.imageFormat === 'string' ? body.imageFormat.toLowerCase() : undefined;
  const rawRotation = typeof body.rotation === 'number' ? Math.round(body.rotation) : 0;
  const rotation = [90, 180, 270].includes(rawRotation) ? rawRotation : 0;

  if (!resizeWidth || !resizeHeight || !resizeQuality || !imageFormat) return null;

  return { resizeWidth, resizeHeight, resizeQuality, imageFormat, rotation };
}

export function getImageArchiveExtension(imageFormat: string): string {
  return imageFormat === 'png' ? 'png' : 'jpg';
}

export function isSharpProcessableImage(sourcePath: string): boolean {
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  return SHARP_INPUT_EXTENSIONS.has(ext);
}

export async function getProcessedImageDimensions(sourcePath: string, options: ImageProcessOptions) {
  const meta = await sharp(sourcePath).metadata().catch(() => null);
  let naturalW = meta?.width ?? 0;
  let naturalH = meta?.height ?? 0;
  if (meta?.orientation && meta.orientation >= 5) {
    [naturalW, naturalH] = [naturalH, naturalW];
  }
  return options.rotation === 90 || options.rotation === 270
    ? { width: naturalH, height: naturalW }
    : { width: naturalW, height: naturalH };
}

export async function processImageFile(
  sourcePath: string,
  outputPath: string,
  options: ImageProcessOptions,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  let pipeline = options.rotation !== 0
    ? sharp(await sharp(sourcePath).rotate().toBuffer()).rotate(options.rotation)
    : sharp(sourcePath).rotate();

  pipeline = pipeline.resize(options.resizeWidth, options.resizeHeight, { fit: 'fill' });

  if (options.imageFormat === 'png') {
    await pipeline.png().toFile(outputPath);
  } else {
    await pipeline.jpeg({ quality: options.resizeQuality }).toFile(outputPath);
  }
}
