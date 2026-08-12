import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(rootDir, '..');

export default defineConfig({
  testDir: path.join(rootDir, 'test/e2e'),
  testMatch: '**/*.spec.ts',
  outputDir: path.join(repositoryRoot, 'test-results'),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { outputFolder: path.join(repositoryRoot, 'playwright-report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: path.join(repositoryRoot, 'playwright-report'), open: 'never' }]],
  projects: [
    {
      name: 'vscode-electron',
      testMatch: '**/electron/**/*.spec.ts',
      metadata: { electronViewportWidth: 1280 },
    },
    {
      name: 'vscode-electron-narrow',
      testMatch: '**/electron/**/*.spec.ts',
      testIgnore: [
        '**/electron/packaged_conversion_smoke.spec.ts',
        // Visual review captures both widths inside one session, so it must run once.
        '**/electron/visual_review_capture.spec.ts',
      ],
      metadata: { electronViewportWidth: 600 },
    },
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
