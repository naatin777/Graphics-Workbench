import { defineConfig } from 'vitest/config';

import { coreSourceAlias } from './vitest.config.js';

// Mandatory external-tool integration suites. Tool paths must be injected via
// GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH, GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH,
// and GRAPHICS_WORKBENCH_TEST_CHROME_PATH; a missing variable fails the suite
// instead of skipping it.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/external/**/*.test.ts'],
    testTimeout: 60000,
    resolve: {
      alias: coreSourceAlias,
    },
  },
});
