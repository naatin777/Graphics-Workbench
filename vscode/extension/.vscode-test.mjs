import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vscode/test-cli';
import { collectCompiledTestFiles } from '../../scripts/compiled-test-files.mjs';
import { buildExtensionHostRuntimeCoverageGlobs } from '../../scripts/extension-host-coverage.mjs';

const repositoryDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(repositoryDirectory, '..', '..');
const configuredUserDataDirectory = process.env.GRAPHICS_WORKBENCH_VSCODE_TEST_USER_DATA_DIR;
const userDataDirectory = path.resolve(
  repositoryRoot,
  configuredUserDataDirectory ?? 'vscode/extension/test/support/.vscode-test-data',
);
const settingsSourcePath = path.join(repositoryDirectory, 'test', 'support', 'vscode-settings', 'settings.json');
const settingsTargetPath = path.join(userDataDirectory, 'User', 'settings.json');
const testWorkspaceDirectory = path.join(repositoryDirectory, 'test', 'support', 'workspace');
const extensionHostTestFiles = collectCompiledTestFiles(repositoryDirectory, 'out/vscode/extension/test').toSorted(
  (left, right) => (left < right ? -1 : left > right ? 1 : 0),
);

mkdirSync(testWorkspaceDirectory, { recursive: true });
for (const entry of readdirSync(testWorkspaceDirectory)) {
  if (entry === '.gitkeep') {
    continue;
  }
  rmSync(path.join(testWorkspaceDirectory, entry), { recursive: true, force: true });
}

if (existsSync(settingsSourcePath)) {
  const settings = JSON.parse(readFileSync(settingsSourcePath, 'utf8'));
  const toolSettings = [
    ['graphics-workbench.execPath.rsvgConvert', 'GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH'],
    ['graphics-workbench.execPath.drawio', 'GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH'],
    ['graphics-workbench.execPath.chrome', 'GRAPHICS_WORKBENCH_TEST_CHROME_PATH'],
  ];

  // The GRAPHICS_WORKBENCH_TEST_* variables are the single source of external
  // tool paths for the test bootstrap: a value already present wins over the
  // settings file, and an unset variable leaves the setting untouched (the CI
  // provisioning scripts write machine paths there; local runs without env
  // get the product's missing-path behavior).
  for (const [key, environmentVariable] of toolSettings) {
    const configured = process.env[environmentVariable];
    if (configured !== undefined && configured !== '') {
      settings[key] = configured;
    }
  }

  mkdirSync(path.dirname(settingsTargetPath), { recursive: true });
  writeFileSync(settingsTargetPath, JSON.stringify(settings, null, 2));
}

export default defineConfig({
  tests: [
    {
      files: extensionHostTestFiles,
      version: 'stable',
      extensionDevelopmentPath: '.',
      srcDir: '.',
      workspaceFolder: './test/support/workspace',
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
    // c8 applies include rules to compiled V8 script URLs before source-map
    // remapping, so these globs must name runtime JavaScript rather than TS.
    includeAll: true,
    // @vscode/test-cli disables relative path matching for cross-platform
    // coverage, so include patterns must be absolute.
    include: buildExtensionHostRuntimeCoverageGlobs(repositoryRoot),
    reporter: ['text-summary', 'html', 'lcov'],
    exclude: ['**/*.d.ts', '**/test/**', '**/scripts/**'],
  },
});
