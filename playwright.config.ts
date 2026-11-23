import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  // Each worker is a browser that renders MapLibre in software (CPU). Playwright's default (half the cores, 10 on
  // a 20-thread laptop) makes the machine crawl; 3 is gentle and still finishes in a few minutes.
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  // Reduced motion: no radar autoplay. Each page software-renders its map, and autoplay preloads 13 radar
  // frames; across parallel workers that starved the CPU and tests timed out at random. No test needs autoplay.
  use: { baseURL: 'http://127.0.0.1:4176', trace: 'off', serviceWorkers: 'allow', reducedMotion: 'reduce' },
  webServer: {
    // Built app served by vite preview with NO /api backend: e2e mocks every network call from fixtures.
    command: 'npx vite build --mode e2e --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4176 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false, // always a fresh e2e build in dist-e2e (never the prod dist/)
    timeout: 180_000,
  },
  projects: [
    { name: 'iphone-se-light', use: { ...devices['iPhone SE'], browserName: 'chromium', colorScheme: 'light' } },
    { name: 'iphone-se-dark', use: { ...devices['iPhone SE'], browserName: 'chromium', colorScheme: 'dark' } },
    { name: 'pixel7-light', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
    { name: 'pixel7-dark', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
    { name: 'desktop-light', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, colorScheme: 'light' } },
    { name: 'desktop-dark', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
  ],
});
