import { describe, it, expect } from 'vitest';
import {
  normalizeRelativeDirectory,
  normalizeUploadFileName,
  normalizeUploadDirectoryName,
  normalizeUploadRelativePath,
  formatTimestamp,
  formatSessionExpiryLabel,
  getProcessedVideoPath,
  getProcessedImagePath,
  getImageThumbnailPath,
  getVideoThumbnailPath,
} from '../file-utils';

describe('normalizeRelativeDirectory', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeRelativeDirectory('')).toBe('');
  });

  it('returns empty string for root path', () => {
    expect(normalizeRelativeDirectory('/')).toBe('');
  });

  it('normalizes single-level path', () => {
    expect(normalizeRelativeDirectory('photos')).toBe('photos');
  });

  it('normalizes path with leading slash', () => {
    expect(normalizeRelativeDirectory('/photos')).toBe('photos');
  });

  it('normalizes nested path', () => {
    expect(normalizeRelativeDirectory('photos/vacation/2024')).toBe('photos/vacation/2024');
  });

  it('resolves parent traversal within root', () => {
    expect(normalizeRelativeDirectory('../etc')).toBe('etc');
  });

  it('resolves deep parent traversal within root', () => {
    expect(normalizeRelativeDirectory('photos/../../../etc')).toBe('etc');
  });

  it('resolves dot segments', () => {
    expect(normalizeRelativeDirectory('photos/./vacation')).toBe('photos/vacation');
  });
});

describe('normalizeUploadFileName', () => {
  it('returns basename of file', () => {
    expect(normalizeUploadFileName('photo.jpg')).toBe('photo.jpg');
  });

  it('trims whitespace', () => {
    expect(normalizeUploadFileName('  photo.jpg  ')).toBe('photo.jpg');
  });

  it('strips directory components', () => {
    expect(normalizeUploadFileName('path/to/file.txt')).toBe('file.txt');
  });

  it('throws on empty name', () => {
    expect(() => normalizeUploadFileName('')).toThrow('Invalid file name');
  });

  it('throws on dot', () => {
    expect(() => normalizeUploadFileName('.')).toThrow('Invalid file name');
  });

  it('throws on double dot', () => {
    expect(() => normalizeUploadFileName('..')).toThrow('Invalid file name');
  });
});

describe('normalizeUploadDirectoryName', () => {
  it('accepts valid directory name', () => {
    expect(normalizeUploadDirectoryName('new_folder')).toBe('new_folder');
  });

  it('extracts basename from path with slash', () => {
    expect(normalizeUploadDirectoryName('a/b')).toBe('b');
  });
});

describe('normalizeUploadRelativePath', () => {
  it('normalizes simple path', () => {
    expect(normalizeUploadRelativePath('photos/photo.jpg')).toBe('photos/photo.jpg');
  });

  it('normalizes path with backslashes', () => {
    expect(normalizeUploadRelativePath('photos\\photo.jpg')).toBe('photos/photo.jpg');
  });

  it('normalizes path with leading slash', () => {
    expect(normalizeUploadRelativePath('/photos/photo.jpg')).toBe('photos/photo.jpg');
  });

  it('throws on empty path', () => {
    expect(() => normalizeUploadRelativePath('')).toThrow('Invalid upload path');
  });

  it('resolves parent traversal within root', () => {
    expect(normalizeUploadRelativePath('../outside')).toBe('outside');
  });

  it('throws on just parent dir reference', () => {
    expect(() => normalizeUploadRelativePath('..')).toThrow('Invalid upload path');
  });
});

describe('formatTimestamp', () => {
  it('formats date as yyyyMMddHHmmss', () => {
    const date = new Date('2024-01-15T14:30:45');
    expect(formatTimestamp(date)).toBe('20240115143045');
  });

  it('pads single-digit values', () => {
    const date = new Date('2024-03-05T09:05:03');
    expect(formatTimestamp(date)).toBe('20240305090503');
  });
});

describe('formatSessionExpiryLabel', () => {
  it('formats 1 minute', () => {
    expect(formatSessionExpiryLabel(60000)).toBe('1 minute');
  });

  it('formats multiple minutes', () => {
    expect(formatSessionExpiryLabel(300000)).toBe('5 minutes');
  });

  it('formats 1 second', () => {
    expect(formatSessionExpiryLabel(1000)).toBe('1 second');
  });

  it('formats multiple seconds', () => {
    expect(formatSessionExpiryLabel(5000)).toBe('5 seconds');
  });

  it('formats milliseconds', () => {
    expect(formatSessionExpiryLabel(500)).toBe('500 ms');
  });
});

describe('getProcessedVideoPath', () => {
  it('returns path to .processed directory with mp4 extension', () => {
    const result = getProcessedVideoPath('/root/videos/movie.mov');
    expect(result).toBe('/root/videos/.processed/movie.mp4');
  });
});

describe('getProcessedImagePath', () => {
  it('returns path to .processed directory with jpg extension', () => {
    const result = getProcessedImagePath('/root/photos/image.png');
    expect(result).toBe('/root/photos/.processed/image.png.jpg');
  });
});

describe('getImageThumbnailPath', () => {
  it('returns path to .thumbnails directory with jpg extension', () => {
    const result = getImageThumbnailPath('/root/photos/image.heic');
    expect(result).toBe('/root/photos/.thumbnails/image.heic.jpg');
  });
});

describe('getVideoThumbnailPath', () => {
  it('returns path to .thumbnails directory with jpg extension', () => {
    const result = getVideoThumbnailPath('/root/videos/movie.mov');
    expect(result).toBe('/root/videos/.thumbnails/movie.mov.jpg');
  });
});
