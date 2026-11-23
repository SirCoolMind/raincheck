// Light/dark: follows the system, with an explicit override (auto → light → dark).
import type { ThemePref } from '../state';

export function applyTheme(pref: ThemePref): 'light' | 'dark' {
  const root = document.documentElement;
  if (pref === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  const eff = effectiveTheme(pref);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', eff === 'dark' ? '#0f3542' : '#0e3b4a');
  return eff;
}

export function effectiveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'auto') return pref;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function onSystemThemeChange(cb: () => void): void {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}
