import { describe, it, expect } from 'vitest';
import { MYT_OFFSET_MS } from '../../src/config';
describe('setup', () => {
  it('MYT is UTC+8', () => expect(MYT_OFFSET_MS).toBe(8 * 3600 * 1000));
});
