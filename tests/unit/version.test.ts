import { describe, it, expect } from 'vitest';
import { APP_VERSION, versionLabel } from '../../src/version';

describe('version', () => {
  it('comes from package.json and is 1.x', () => {
    expect(APP_VERSION).toMatch(/^1\.\d+\.\d+$/);
  });
  it('label drops a zero patch', () => {
    expect(versionLabel('1.0.0')).toBe('v1.0');
    expect(versionLabel('1.2.3')).toBe('v1.2.3');
  });
});
