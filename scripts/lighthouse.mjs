// Lighthouse on the production build (vite preview on :4173 with the PHP API proxied from :8787).
// Uses Playwright's Chromium. Prints only scores; full JSON goes to .lighthouse/ (gitignored).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
mkdirSync('.lighthouse', { recursive: true });
const chrome = chromium.executablePath();
const run = (preset, out) => {
  const args = ['lighthouse', url, '--quiet', '--output=json', `--output-path=${out}`, '--only-categories=performance,accessibility,best-practices',
    `--chrome-path=${chrome}`, '--chrome-flags=--headless=new --no-sandbox'];
  if (preset === 'desktop') args.push('--preset=desktop');
  execFileSync('npx', args, { stdio: 'inherit', shell: true });
  const r = JSON.parse(readFileSync(out, 'utf8'));
  const c = r.categories;
  const pct = (k) => Math.round((c[k]?.score ?? 0) * 100);
  const audits = r.audits;
  console.log(`${preset}: performance ${pct('performance')} · accessibility ${pct('accessibility')} · best-practices ${pct('best-practices')} · LCP ${audits['largest-contentful-paint']?.displayValue} · TBT ${audits['total-blocking-time']?.displayValue} · CLS ${audits['cumulative-layout-shift']?.displayValue}`);
  const fails = Object.values(audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary').map((a) => a.id);
  if (fails.length) console.log(`  failing binary audits: ${fails.join(', ')}`);
};
run('mobile', '.lighthouse/mobile.json');
run('desktop', '.lighthouse/desktop.json');
