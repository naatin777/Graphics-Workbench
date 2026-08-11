import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const excalidrawRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(excalidrawRoot, '..', '..');
const repositoryRoot = resolve(projectRoot, '..');
const outDir = resolve(projectRoot, 'media', 'excalidraw');

export default defineConfig({
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: {
      entry: resolve(excalidrawRoot, 'entry.ts'),
      formats: ['es'],
      fileName: () => 'excalidraw-adapter.mjs',
    },
  },
  plugins: [
    {
      name: 'copy-excalidraw-fonts',
      apply: 'build',
      closeBundle(): void {
        const fontsSource = resolve(
          repositoryRoot,
          'node_modules',
          '@excalidraw',
          'excalidraw',
          'dist',
          'prod',
          'fonts',
        );
        if (!existsSync(fontsSource)) {
          throw new Error(`Excalidraw bundled fonts not found: ${fontsSource}`);
        }
        const fontsTarget = resolve(outDir, 'fonts');
        mkdirSync(dirname(fontsTarget), { recursive: true });
        cpSync(fontsSource, fontsTarget, { recursive: true });
      },
    },
  ],
});
