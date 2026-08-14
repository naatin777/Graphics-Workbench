import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const coreDirectory = path.dirname(fileURLToPath(import.meta.url));

/**
 * The core tests exercise the TypeScript sources directly instead of the
 * built dist. Coverage then maps the same sources it executed. The built
 * package exports are verified separately by the package-export smoke test.
 */
export const coreSourceAlias = [
  {
    find: /^@graphics-workbench\/core\/(conversion|pdf|formats|runtime|security|output|table)$/u,
    replacement: path.join(coreDirectory, 'src/public/$1.ts'),
  },
  {
    find: /^@graphics-workbench\/core\/external-tools$/u,
    replacement: path.join(coreDirectory, 'src/public/external_tools.ts'),
  },
  {
    find: /^@graphics-workbench\/core\/crop-worker$/u,
    replacement: path.join(coreDirectory, 'src/public/crop_worker.ts'),
  },
  {
    find: /^@graphics-workbench\/core\/testing$/u,
    replacement: path.join(coreDirectory, 'testing/index.ts'),
  },
];

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    // The external-tool suites run as a separate mandatory job
    // (test:external) with tool paths injected via environment variables.
    exclude: [
      'test/external/**',
      // terminate_process_tree runs under node:test module mocks
      // (--experimental-test-module-mocks); see test:module-mocks.
      'test/unit/operations/terminate_process_tree.test.ts',
    ],
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: '../coverage/core',
      include: ['src/**/*.ts'],
    },
    alias: coreSourceAlias,
  },
});
