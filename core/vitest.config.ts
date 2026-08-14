import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    // terminate_process_tree runs under node:test module mocks
    // (--experimental-test-module-mocks); see test:module-mocks.
    exclude: ['test/unit/operations/terminate_process_tree.test.ts'],
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: '../coverage/core',
      include: ['src/**/*.ts'],
    },
  },
});
