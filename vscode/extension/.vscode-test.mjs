import { execFileSync } from 'node:child_process';
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
  const toolCommands = [
    ['graphics-workbench.execPath.rsvgConvert', 'rsvg-convert'],
    ['graphics-workbench.execPath.drawio', 'drawio'],
    ['graphics-workbench.execPath.chrome', 'google-chrome'],
  ];

  for (const [key, command] of toolCommands) {
    if (typeof settings[key] !== 'string' || settings[key] === '') {
      const resolved =
        key === 'graphics-workbench.execPath.drawio'
          ? (resolveExecutable(command) ?? resolveDrawioExecutable())
          : resolveExecutable(command);
      if (resolved !== undefined) {
        settings[key] = resolved;
      }
    }
  }

  mkdirSync(path.dirname(settingsTargetPath), { recursive: true });
  writeFileSync(settingsTargetPath, JSON.stringify(settings, null, 2));
}

function resolveExecutable(command) {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';

  try {
    const output = execFileSync(lookupCommand, [command], { encoding: 'utf8' });
    return output
      .split(/\r?\n/u)
      .find((line) => line.trim() !== '')
      ?.trim();
  } catch {
    return undefined;
  }
}

function resolveDrawioExecutable() {
  if (process.platform !== 'darwin') {
    return undefined;
  }
  const appPath = '/Applications/draw.io.app/Contents/MacOS/draw.io';
  return existsSync(appPath) ? appPath : undefined;
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
