import { describe, it, expect } from 'vitest';
import {
  normalizeArchiveEntryPath,
  compareArchiveEntries,
  formatZipTimestamp,
} from '../archive';

describe('normalizeArchiveEntryPath', () => {
  it('normalizes a file path', () => {
    expect(normalizeArchiveEntryPath('photos/vacation/photo.jpg')).toBe('photos/vacation/photo.jpg');
  });

  it('removes leading slash', () => {
    expect(normalizeArchiveEntryPath('/photos/photo.jpg')).toBe('photos/photo.jpg');
  });

  it('returns empty for root', () => {
    expect(normalizeArchiveEntryPath('')).toBe('');
  });

  it('returns empty for dot', () => {
    expect(normalizeArchiveEntryPath('.')).toBe('');
  });

  it('resolves parent traversal within root', () => {
    expect(normalizeArchiveEntryPath('../outside')).toBe('outside');
  });

  it('normalizes dot segments', () => {
    expect(normalizeArchiveEntryPath('photos/./photo.jpg')).toBe('photos/photo.jpg');
  });
});

describe('compareArchiveEntries', () => {
  it('sorts by path alphabetically', () => {
    expect(compareArchiveEntries({ path: 'b' }, { path: 'a' })).toBeGreaterThan(0);
    expect(compareArchiveEntries({ path: 'a' }, { path: 'b' })).toBeLessThan(0);
    expect(compareArchiveEntries({ path: 'a' }, { path: 'a' })).toBe(0);
  });
});

describe('formatZipTimestamp', () => {
  it('formats date as yyyy-MM-ddTHH:mm:ss', () => {
    const date = new Date('2024-06-15T09:30:45');
    expect(formatZipTimestamp(date)).toBe('2024-06-15T09:30:45');
  });
});
