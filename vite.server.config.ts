import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * Server bundle. Devvit wants one self-contained CommonJS file that imports
 * nothing but Node builtins, so everything is bundled in.
 */
export default defineConfig({
  ssr: {
    target: 'node',
    noExternal: true,
  },
  build: {
    ssr: 'src/server/index.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    minify: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
        inlineDynamicImports: true,
      },
    },
  },
});
