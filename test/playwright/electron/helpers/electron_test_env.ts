import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { type ElectronApplication, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

import { cropConfigureFixture } from '../../../helpers/crop_configure_fixture.js';
import { writeVscodeUserSettings } from './vscode_electron_test.js';
import { installPackagedVsix } from './packaged_vsix.js';

const vscodeVersion = '1.128.0';
const temporaryBase = process.platform === 'win32' ? tmpdir() : '/tmp';

export interface ElectronTestEnv {
  electronApp: ElectronApplication;
  window: Page;
  workspacePath: string;
  userDataDir: string;
  sharedDataDir: string;
  extensionsDir: string;
  extensionPath: string;
  temporaryRoot: string;
  inputPath: string;
  outputPath: string;
  sourceFixtureBytes: Uint8Array;
}

export interface ElectronTestOptions {
  colorTheme?: string;
  extraSettings?: Record<string, unknown>;
  copyFixtures?: boolean;
}

export function resolvePackagedVsixPath(): string {
  const value = resolve(process.cwd(), 'latex-graphics-helper.vsix');

  let fileStats;

  try {
    fileStats = statSync(value);
  } catch {
    throw new Error(`Packaged VSIX does not exist: ${value}. Run package:vsix before Electron Playwright.`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Packaged VSIX must be a regular file: ${value}`);
  }

  return value;
}

export async function setupElectronTest(
  electron: {
    launch: (options: { executablePath: string; cwd: string; args: string[] }) => Promise<ElectronApplication>;
  },
  packagedVsixPath: string,
  options: ElectronTestOptions = {},
): Promise<ElectronTestEnv> {
  const colorTheme = options.colorTheme ?? 'Default Dark Modern';
  const extraSettings = options.extraSettings ?? {};
  const copyFixtures = options.copyFixtures ?? true;

  const temporaryRoot = await mkdtemp(join(temporaryBase, 'lgh-electron-'));
  const workspacePath = join(temporaryRoot, 'workspace');
  const userDataDir = join(temporaryRoot, 'user-data');
  const userSettingsDir = join(userDataDir, 'User');
  const userSettingsPath = join(userSettingsDir, 'settings.json');
  const sharedDataDir = join(temporaryRoot, 'shared-data');
  const extensionsDir = join(temporaryRoot, 'extensions');

  const projectRoot = process.cwd();
  const sourceFixture = join(
    projectRoot,
    'test',
    'fixtures',
    'pdf-operations',
    'user-files',
    cropConfigureFixture.fileName,
  );
  const rasterSourceFixture = join(projectRoot, 'test', 'fixtures', 'test.png');
  const inputPath = join(workspacePath, cropConfigureFixture.fileName);
  const outputPath = join(workspacePath, 'q a-crop.pdf');

  await Promise.all([
    mkdir(workspacePath),
    mkdir(userSettingsDir, { recursive: true }),
    mkdir(sharedDataDir),
    mkdir(extensionsDir),
  ]);

  if (copyFixtures) {
    await Promise.all([
      cp(sourceFixture, inputPath),
      cp(rasterSourceFixture, join(workspacePath, 'packaged-raster-input.png')),
    ]);
  }

  const sourceFixtureBytes = copyFixtures ? await readFile(sourceFixture) : new Uint8Array();

  await writeVscodeUserSettings(userSettingsPath, colorTheme, {
    'latex-graphics-helper.execPath.pdftocairo':
      process.platform === 'win32' ? 'C:\\lgh-missing\\pdftocairo.exe' : '/lgh-missing/pdftocairo',
    ...extraSettings,
  });

  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: vscodeVersion });

  const installedExtension = await installPackagedVsix({
    extensionsDir,
    userDataDir,
    version: vscodeVersion,
    vsixPath: packagedVsixPath,
  });

  const electronApp = await electron.launch({
    executablePath: vscodeExecutablePath,
    cwd: projectRoot,
    args: [
      workspacePath,
      `--user-data-dir=${userDataDir}`,
      `--shared-data-dir=${sharedDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--no-cached-data',
      '--locale=en',
      '--host-resolver-rules=MAP * ~NOTFOUND',
    ],
  });

  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 900 });

  return {
    electronApp,
    window,
    workspacePath,
    userDataDir,
    sharedDataDir,
    extensionsDir,
    extensionPath: installedExtension.extensionPath,
    temporaryRoot,
    inputPath,
    outputPath,
    sourceFixtureBytes,
  };
}

export async function loadPackagedOperation<T>(extensionPath: string, relativePath: string): Promise<T> {
  return (await import(pathToFileURL(join(extensionPath, relativePath)).href)) as T;
}
