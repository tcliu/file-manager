import { describe, it, expect } from 'vitest';
import { getInlineContentType, getContentDisposition } from '../constants';

describe('getInlineContentType', () => {
  it('returns image/jpeg for .jpg', () => {
    expect(getInlineContentType('photo.jpg')).toBe('image/jpeg');
  });

  it('returns image/jpeg for .jpeg', () => {
    expect(getInlineContentType('photo.jpeg')).toBe('image/jpeg');
  });

  it('returns image/png for .png', () => {
    expect(getInlineContentType('image.png')).toBe('image/png');
  });

  it('returns image/gif for .gif', () => {
    expect(getInlineContentType('animation.gif')).toBe('image/gif');
  });

  it('returns image/webp for .webp', () => {
    expect(getInlineContentType('img.webp')).toBe('image/webp');
  });

  it('returns image/avif for .avif', () => {
    expect(getInlineContentType('img.avif')).toBe('image/avif');
  });

  it('returns image/bmp for .bmp', () => {
    expect(getInlineContentType('img.bmp')).toBe('image/bmp');
  });

  it('returns image/heic for .heic', () => {
    expect(getInlineContentType('img.heic')).toBe('image/heic');
  });

  it('returns image/heif for .heif', () => {
    expect(getInlineContentType('img.heif')).toBe('image/heif');
  });

  it('returns image/svg+xml for .svg', () => {
    expect(getInlineContentType('vector.svg')).toBe('image/svg+xml');
  });

  it('returns video/mp4 for .mp4', () => {
    expect(getInlineContentType('video.mp4')).toBe('video/mp4');
  });

  it('returns video/mp4 for .m4v', () => {
    expect(getInlineContentType('video.m4v')).toBe('video/mp4');
  });

  it('returns video/quicktime for .mov', () => {
    expect(getInlineContentType('video.mov')).toBe('video/quicktime');
  });

  it('returns video/mpeg for .mpeg', () => {
    expect(getInlineContentType('video.mpeg')).toBe('video/mpeg');
  });

  it('returns video/mpeg for .mpg', () => {
    expect(getInlineContentType('video.mpg')).toBe('video/mpeg');
  });

  it('returns video/webm for .webm', () => {
    expect(getInlineContentType('video.webm')).toBe('video/webm');
  });

  it('returns application/pdf for .pdf', () => {
    expect(getInlineContentType('doc.pdf')).toBe('application/pdf');
  });

  it('returns application/octet-stream for unknown extension', () => {
    expect(getInlineContentType('file.xyz')).toBe('application/octet-stream');
  });

  it('returns application/octet-stream for file with no extension', () => {
    expect(getInlineContentType('Makefile')).toBe('application/octet-stream');
  });

  it('handles uppercase extension', () => {
    expect(getInlineContentType('photo.JPG')).toBe('image/jpeg');
  });
});

describe('getContentDisposition', () => {
  it('creates inline disposition', () => {
    const result = getContentDisposition('photo.jpg', 'inline');
    expect(result).toBe('inline; filename="photo.jpg"; filename*=UTF-8\'\'photo.jpg');
  });

  it('creates attachment disposition', () => {
    const result = getContentDisposition('archive.zip', 'attachment');
    expect(result).toBe('attachment; filename="archive.zip"; filename*=UTF-8\'\'archive.zip');
  });

  it('strips double quotes from filename', () => {
    const result = getContentDisposition('my"file".txt', 'inline');
    expect(result).toContain('filename="myfile.txt"');
  });

  it('replaces non-ASCII characters', () => {
    const result = getContentDisposition('café.txt', 'inline');
    expect(result).toContain('filename="caf?.txt"');
  });

  it('encodes special characters in filename*', () => {
    const result = getContentDisposition('file name.txt', 'inline');
    expect(result).toContain("filename*=UTF-8''file%20name.txt");
  });
});
