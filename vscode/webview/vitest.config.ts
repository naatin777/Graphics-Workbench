import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const webviewRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const protocolRoot = resolve(webviewRoot, '..', 'protocol');
const repositoryRoot = resolve(webviewRoot, '..', '..');

export default defineConfig({
  root: webviewRoot,
  plugins: [solid({ hot: false })],
  resolve: {
    alias: {
      '@webview-shared': resolve(webviewRoot, 'src', 'shared'),
      '@graphics-workbench-typed-protocol': resolve(protocolRoot, 'protocols/typed_protocol.ts'),
      '@graphics-workbench-crop-pdf-protocol': resolve(protocolRoot, 'protocols/crop_pdf_protocol.ts'),
      '@graphics-workbench-merge-pdf-protocol': resolve(protocolRoot, 'protocols/merge_pdf_protocol.ts'),
      '@graphics-workbench-split-pdf-protocol': resolve(protocolRoot, 'protocols/split_pdf_protocol.ts'),
      '@graphics-workbench-rotate-pdf-protocol': resolve(protocolRoot, 'protocols/rotate_pdf_protocol.ts'),
      '@graphics-workbench-reorder-pdf-protocol': resolve(protocolRoot, 'protocols/reorder_pdf_protocol.ts'),
      '@graphics-workbench-preview-protocol': resolve(protocolRoot, 'protocols/preview_protocol.ts'),
      '@graphics-workbench-table-editor-protocol': resolve(protocolRoot, 'protocols/table_editor_protocol.ts'),
      '@graphics-workbench-table-model': resolve(protocolRoot, 'table/table_model.ts'),
      '@graphics-workbench-table-parser': resolve(protocolRoot, 'table/parse_delimited.ts'),
      '@graphics-workbench-table-renderer': resolve(protocolRoot, 'table/table_renderer.ts'),
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
