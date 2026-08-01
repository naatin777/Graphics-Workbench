import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from '@vscode/test-cli';

const repositoryDirectory = process.cwd();
const configuredUserDataDirectory = process.env.GRAPHICS_WORKBENCH_VSCODE_TEST_USER_DATA_DIR;
const userDataDirectory = path.resolve(repositoryDirectory, configuredUserDataDirectory ?? 'test/.vscode-test-data');
const settingsSourcePath = path.join(repositoryDirectory, 'test', 'vscode-settings', 'settings.json');
const settingsTargetPath = path.join(userDataDirectory, 'User', 'settings.json');
const testWorkspaceDirectory = path.join(repositoryDirectory, 'test', 'workspace');

mkdirSync(testWorkspaceDirectory, { recursive: true });
for (const entry of readdirSync(testWorkspaceDirectory)) {
  rmSync(path.join(testWorkspaceDirectory, entry), { recursive: true, force: true });
}

if (existsSync(settingsSourcePath)) {
  const settings = JSON.parse(readFileSync(settingsSourcePath, 'utf8'));
  const toolCommands = [
    ['graphics-workbench.execPath.ghostscript', process.platform === 'win32' ? 'gswin64c' : 'gs'],
    ['graphics-workbench.execPath.pdftocairo', 'pdftocairo'],
    ['graphics-workbench.execPath.rsvgConvert', 'rsvg-convert'],
  ];

  for (const [key, command] of toolCommands) {
    if (typeof settings[key] !== 'string' || settings[key] === '') {
      const resolved = resolveExecutable(command);
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
