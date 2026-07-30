import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from '@vscode/test-cli';

const repositoryDirectory = process.cwd();
const configuredUserDataDirectory = process.env.GRAPHICS_WORKBENCH_VSCODE_TEST_USER_DATA_DIR;
const userDataDirectory = path.resolve(repositoryDirectory, configuredUserDataDirectory ?? 'test/.vscode-test-data');
const settingsSourcePath = path.join(repositoryDirectory, 'test', 'vscode-settings', 'settings.json');
const settingsTargetPath = path.join(userDataDirectory, 'User', 'settings.json');

if (existsSync(settingsSourcePath)) {
  mkdirSync(path.dirname(settingsTargetPath), { recursive: true });
  writeFileSync(settingsTargetPath, readFileSync(settingsSourcePath));
}

export default defineConfig({
  tests: [
    {
      files: 'out/test/**/*.test.js',
      version: '1.128.0',
      extensionDevelopmentPath: '.',
      srcDir: 'src',
      workspaceFolder: './test/workspace',
      mocha: {
        ui: 'tdd',
        timeout: 60000,
        slow: 5000,
        reporter: 'list',
        color: true,
      },
      launchArgs: [
        '--disable-extensions',
        '--skip-welcome',
        '--disable-workspace-trust',
        `--user-data-dir=${userDataDirectory}`,
      ],
    },
  ],
  coverage: {
    // include globs currently discard the Extension Host V8 entries after remapping.
    // Keep source discovery anchored by srcDir and exclude only known non-source files.
    includeAll: process.platform !== 'win32',
    reporter: ['text-summary', 'html', 'lcov'],
    exclude: ['**/*.d.ts', '**/test/**', '**/scripts/**'],
  },
});
