import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const webviewRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const repositoryRoot = resolve(webviewRoot, '..', '..');

export default defineConfig({
  root: webviewRoot,
  plugins: [solid({ hot: false })],
  resolve: {
    alias: {
      '@webview-shared': resolve(webviewRoot, 'src', 'shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: resolve(repositoryRoot, 'coverage', 'webview'),
      include: [resolve(webviewRoot, 'src/**/*.{ts,tsx}')],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    },
  },
});
