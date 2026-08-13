import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const webviewRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(webviewRoot, '..', '..');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: path.join(repositoryRoot, 'test-results'),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { outputFolder: path.join(repositoryRoot, 'playwright-report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: path.join(repositoryRoot, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173/?page=preview',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-wide',
      testMatch: '**/*.spec.ts',
      testIgnore: ['responsive.spec.ts'],
      use: {
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: 'chromium-narrow',
      testMatch: '**/*.spec.ts',
      testIgnore: ['responsive.spec.ts', 'visual_review_capture.spec.ts'],
      use: {
        viewport: { width: 600, height: 900 },
      },
    },
  ],
});
