import { defineConfig } from 'vite';

// Ports can be overridden by start.bat (which picks free ports); defaults match the docs.
const envPort = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};
const webPort = envPort('RAINCHECK_WEB_PORT', 5173);
const apiTarget = `http://127.0.0.1:${envPort('RAINCHECK_API_PORT', 8787)}`;

export default defineConfig({
  server: {
    port: webPort,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    minify: process.env.RC_NOMINIFY ? false : 'esbuild',
    rollupOptions: {
      output: { manualChunks: { maplibre: ['maplibre-gl'] } },
    },
  },
});
