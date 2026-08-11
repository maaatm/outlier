import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Client bundle. Everything under `dist/client` is uploaded to Reddit and served
 * as the web view root, so asset URLs must stay relative.
 */
export default defineConfig({
  root: 'src/client',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    // The whole app is one screen. A single chunk beats a waterfall inside an
    // iframe that the user only looks at for fifteen seconds.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
