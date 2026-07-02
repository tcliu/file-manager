import path from 'node:path';

export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_UPLOAD_DIR = 'upload';
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500, 'All'] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export const METADATA_DIR_NAME = '.file-manager';
export const METADATA_FILE = 'metadata.yml';
export const PROCESSED_DIR_NAME = 'processed';
export const THUMBNAIL_DIR_NAME = 'thumbnails';
export const THUMBNAIL_MAX_WIDTH = 480;
export const THUMBNAIL_MAX_HEIGHT = 360;
export const THUMBNAIL_QUALITY = 82;
export const VIDEO_THUMBNAIL_QUALITY = 3;

export const RAW_IMAGE_EXTENSIONS = new Set(['arw']);

export const IMAGE_EXTENSIONS = new Set([
  'arw', 'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg',
  'png', 'svg', 'webp',
]);

export const VIDEO_EXTENSIONS = new Set([
  'm4v', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'
]);

export const THUMBNAIL_SUPPORTED_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

export function getInlineContentType(filePath: string): string {
  switch (path.extname(filePath).slice(1).toLowerCase()) {
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    case 'gif': return 'image/gif';
    case 'heic': return 'image/heic';
    case 'heif': return 'image/heif';
    case 'jpeg':
    case 'jpg': return 'image/jpeg';
    case 'm4v':
    case 'mp4': return 'video/mp4';
    case 'mov': return 'video/quicktime';
    case 'mpeg':
    case 'mpg': return 'video/mpeg';
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'svg': return 'image/svg+xml';
    case 'webm': return 'video/webm';
    case 'webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

export function getContentDisposition(fileName: string, type: 'inline' | 'attachment'): string {
  const safe = fileName.replaceAll('"', '').replace(/[^\x20-\x7E]/g, '?');
  return `${type}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
