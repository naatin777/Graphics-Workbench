import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const webviewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(webviewRoot, '..', '..');

export interface WebviewTestConfig {
  appName: string;
}

export function defineWebviewTestConfig(config: WebviewTestConfig): ReturnType<typeof defineConfig> {
  return defineConfig({
    root: resolve(webviewRoot, 'apps', config.appName),
    plugins: [solid({ hot: false })],
    resolve: {
      alias: {
        '@webview-shared': resolve(webviewRoot, 'shared'),
        '@graphics-workbench-crop-pdf-protocol': resolve(webviewRoot, '../src/shared/protocols/crop_pdf_protocol.ts'),
        '@graphics-workbench-merge-pdf-protocol': resolve(webviewRoot, '../src/shared/protocols/merge_pdf_protocol.ts'),
        '@graphics-workbench-split-pdf-protocol': resolve(webviewRoot, '../src/shared/protocols/split_pdf_protocol.ts'),
        '@graphics-workbench-rotate-pdf-protocol': resolve(
          webviewRoot,
          '../src/shared/protocols/rotate_pdf_protocol.ts',
        ),
        '@graphics-workbench-reorder-pdf-protocol': resolve(
          webviewRoot,
          '../src/shared/protocols/reorder_pdf_protocol.ts',
        ),
        '@graphics-workbench-preview-protocol': resolve(webviewRoot, '../src/shared/protocols/preview_protocol.ts'),
        '@graphics-workbench-table-editor-protocol': resolve(
          webviewRoot,
          '../src/shared/protocols/table_editor_protocol.ts',
        ),
        '@graphics-workbench-table-model': resolve(webviewRoot, '../src/table/table_model.ts'),
        '@graphics-workbench-table-parser': resolve(webviewRoot, '../src/table/parse_delimited.ts'),
        '@graphics-workbench-table-renderer': resolve(webviewRoot, '../src/table/table_renderer.ts'),
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
        reportsDirectory: resolve(repositoryRoot, 'coverage', 'webview', config.appName),
        include: [
          resolve(webviewRoot, 'apps', config.appName, 'src/**/*.{ts,tsx}'),
          resolve(webviewRoot, 'shared/**/*.{ts,tsx}'),
        ],
        exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      },
    },
  });
}
