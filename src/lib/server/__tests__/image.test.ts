import { describe, it, expect } from 'vitest';
import {
  extractFfmpegErrorDetail,
  normalizeExifOffset,
  joinExifTimestampParts,
  parseExifTimestamp,
} from '../image';

describe('extractFfmpegErrorDetail', () => {
  it('returns meaningful lines from stderr', () => {
    const stderr = 'Error: something failed\nConversion failed!\nInvalid data found';
    const result = extractFfmpegErrorDetail(stderr, 1);
    expect(result).toContain('Error: something failed');
    expect(result).toContain('Invalid data found');
    expect(result).not.toContain('Conversion failed!');
  });

  it('returns fallback message for empty stderr', () => {
    const result = extractFfmpegErrorDetail('', 1);
    expect(result).toBe('ffmpeg exited with code 1');
  });

  it('returns fallback for undefined stderr', () => {
    const result = extractFfmpegErrorDetail(undefined, 1);
    expect(result).toBe('ffmpeg exited with code 1');
  });

  it('returns up to 4 lines from the end', () => {
    const stderr = 'line1\nline2\nline3\nline4\nline5';
    const result = extractFfmpegErrorDetail(stderr, 1);
    expect(result).toBe('line2 | line3 | line4 | line5');
  });
});

describe('normalizeExifOffset', () => {
  it('returns empty string for null', () => {
    expect(normalizeExifOffset(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeExifOffset(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeExifOffset('')).toBe('');
  });

  it('passes through valid +HH:MM offset', () => {
    expect(normalizeExifOffset('+05:30')).toBe('+05:30');
  });

  it('passes through valid -HH:MM offset', () => {
    expect(normalizeExifOffset('-08:00')).toBe('-08:00');
  });

  it('passes through Z offset', () => {
    expect(normalizeExifOffset('Z')).toBe('Z');
  });

  it('normalizes +HHMM (no colon) to +HH:MM', () => {
    expect(normalizeExifOffset('+0530')).toBe('+05:30');
  });

  it('normalizes -HHMM (no colon) to -HH:MM', () => {
    expect(normalizeExifOffset('-0800')).toBe('-08:00');
  });

  it('normalizes +H to +HH:00', () => {
    expect(normalizeExifOffset('+5')).toBe('+05:00');
  });

  it('normalizes -H to -HH:00', () => {
    expect(normalizeExifOffset('-8')).toBe('-08:00');
  });

  it('returns empty string for invalid format', () => {
    expect(normalizeExifOffset('abc')).toBe('');
  });
});

describe('joinExifTimestampParts', () => {
  it('joins timestamp, subsecond, and offset', () => {
    expect(joinExifTimestampParts('2024:01:15 14:30:45', '123', '+05:30'))
      .toBe('2024:01:15 14:30:45.123+05:30');
  });

  it('joins timestamp and offset without subsecond', () => {
    expect(joinExifTimestampParts('2024:01:15 14:30:45', '', '+05:30'))
      .toBe('2024:01:15 14:30:45+05:30');
  });

  it('returns null for empty timestamp', () => {
    expect(joinExifTimestampParts('', null, null)).toBeNull();
  });

  it('returns null for null timestamp', () => {
    expect(joinExifTimestampParts(null, null, null)).toBeNull();
  });

  it('strips non-digits from subsecond', () => {
    expect(joinExifTimestampParts('2024:01:15 14:30:45', '123abc!@#', ''))
      .toBe('2024:01:15 14:30:45.123');
  });
});

describe('parseExifTimestamp', () => {
  it('parses standard EXIF timestamp', () => {
    const result = parseExifTimestamp('2024:01:15 14:30:45');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(0); // January
    expect(result!.getDate()).toBe(15);
    expect(result!.getHours()).toBe(14);
    expect(result!.getMinutes()).toBe(30);
  });

  it('parses EXIF timestamp with offset', () => {
    const result = parseExifTimestamp('2024:01:15 14:30:45+05:30');
    expect(result!.toISOString()).toContain('2024-01-15T09:00:45');
  });

  it('returns null for invalid input', () => {
    expect(parseExifTimestamp('not-a-date')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(parseExifTimestamp(null)).toBeNull();
  });
});
