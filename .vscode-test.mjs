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
// node:test suites (e.g. terminate_process_tree.test.ts) use module mocks and a
// top-level dynamic import; they crash the Mocha extension host runner, so run
// them under node --test (test:scripts) instead.
const extensionHostTestFiles = collectTestFiles(repositoryDirectory, 'out/test');

function collectTestFiles(rootDirectory, directory, files = []) {
  for (const entry of readdirSync(path.join(rootDirectory, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(rootDirectory, relative, files);
    } else if (entry.isFile() && entry.name.endsWith('.test.js') && entry.name !== 'terminate_process_tree.test.js') {
      files.push(relative);
    }
  }
  return files;
}

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
    ['graphics-workbench.execPath.mermaid', 'mmdc'],
    ['graphics-workbench.execPath.drawio', 'drawio'],
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
    // Include all src files so every platform reports the same file count,
    // even for modules the extension host did not load at runtime.
    includeAll: true,
    reporter: ['text-summary', 'html', 'lcov'],
    exclude: ['**/*.d.ts', '**/test/**', '**/scripts/**'],
  },
});
