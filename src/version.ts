// App version, from package.json (a named JSON import, so only this field ends up in the bundle).
import { version } from '../package.json';

export const APP_VERSION: string = version;

/** "1.0.0" → "v1.0", "1.2.3" → "v1.2.3". */
export function versionLabel(v: string = APP_VERSION): string {
  const [maj = '0', min = '0', patch = '0'] = v.split('.');
  return patch === '0' ? `v${maj}.${min}` : `v${maj}.${min}.${patch}`;
}
