import { describe, it, expect } from 'vitest';
import { parseFileSize, parseEnvFile, parseSessionExpiryMs } from '../config';

describe('parseFileSize', () => {
  it('parses bytes', () => {
    expect(parseFileSize('500B')).toBe(500);
  });

  it('parses kilobytes', () => {
    expect(parseFileSize('1KB')).toBe(1000);
  });

  it('parses megabytes', () => {
    expect(parseFileSize('5MB')).toBe(5 * 1000 ** 2);
  });

  it('parses gigabytes', () => {
    expect(parseFileSize('2GB')).toBe(2 * 1000 ** 3);
  });

  it('parses terabytes', () => {
    expect(parseFileSize('1TB')).toBe(1000 ** 4);
  });

  it('returns null for invalid input', () => {
    expect(parseFileSize('abc')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseFileSize('0')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseFileSize('')).toBeNull();
  });

  it('parses without unit (defaults to bytes)', () => {
    expect(parseFileSize('1024')).toBe(1024);
  });

  it('handles case insensitive units', () => {
    expect(parseFileSize('1mb')).toBe(1000 ** 2);
    expect(parseFileSize('1MB')).toBe(1000 ** 2);
  });
});

describe('parseEnvFile', () => {
  it('parses key=value lines', () => {
    const result = parseEnvFile('KEY=value\nFOO=bar');
    expect(result).toEqual({ KEY: 'value', FOO: 'bar' });
  });

  it('skips comments', () => {
    const result = parseEnvFile('# comment\nKEY=value');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('skips empty lines', () => {
    const result = parseEnvFile('KEY=value\n\nOTHER=123');
    expect(result).toEqual({ KEY: 'value', OTHER: '123' });
  });

  it('trims whitespace from key and value', () => {
    const result = parseEnvFile('  KEY  =  value  ');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('handles Windows line endings', () => {
    const result = parseEnvFile('KEY=value\r\nOTHER=123');
    expect(result).toEqual({ KEY: 'value', OTHER: '123' });
  });

  it('returns empty object for empty content', () => {
    expect(parseEnvFile('')).toEqual({});
  });

  it('skips lines without =', () => {
    const result = parseEnvFile('KEY=value\nINVALID_LINE');
    expect(result).toEqual({ KEY: 'value' });
  });
});

describe('parseSessionExpiryMs', () => {
  it('returns the value for valid integer', () => {
    expect(parseSessionExpiryMs('5000')).toBe(5000);
  });

  it('returns default for undefined', () => {
    expect(parseSessionExpiryMs(undefined)).toBe(3600000);
  });

  it('returns default for zero', () => {
    expect(parseSessionExpiryMs('0')).toBe(3600000);
  });

  it('returns default for negative value', () => {
    expect(parseSessionExpiryMs('-1000')).toBe(3600000);
  });

  it('returns default for non-integer', () => {
    expect(parseSessionExpiryMs('abc')).toBe(3600000);
  });
});
