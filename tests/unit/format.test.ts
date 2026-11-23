import { describe, it, expect } from 'vitest';
import { formatAgo, formatMmh, formatProb } from '../../src/core/format';

describe('format', () => {
  it('formatMmh', () => {
    expect(formatMmh(null)).toBe('—');
    expect(formatMmh(0)).toBe('0');
    expect(formatMmh(0.4)).toBe('0.4 mm/h');
    expect(formatMmh(12.345)).toBe('12.3 mm/h');
  });
  it('formatAgo', () => {
    const now = 10_000_000;
    expect(formatAgo(now - 30_000, now)).toBe('just now');
    expect(formatAgo(now + 5000, now)).toBe('just now');
    expect(formatAgo(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(formatAgo(now - 59 * 60_000, now)).toBe('59 min ago');
    expect(formatAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
  });
  it('formatProb', () => {
    expect(formatProb(null)).toBe('—');
    expect(formatProb(40)).toBe('40%');
  });
});
