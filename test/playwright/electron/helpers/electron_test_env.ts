import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { type ElectronApplication, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

import { cropConfigureFixture } from '../../../helpers/crop_configure_fixture.js';
import { disposeElectronTest, writeVscodeUserSettings } from './vscode_electron_test.js';
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

export interface PreparedElectronTest {
  extensionPath: string;
  extensionsDir: string;
  installationRoot: string;
  vscodeExecutablePath: string;
}

export interface ElectronTestOptions {
  colorTheme?: string;
  extraSettings?: Record<string, unknown>;
  copyFixtures?: boolean;
  prepared?: PreparedElectronTest;
}

export async function prepareElectronTest(packagedVsixPath: string): Promise<PreparedElectronTest> {
  const installationRoot = await mkdtemp(join(temporaryBase, 'graphics-workbench-electron-package-'));
  const extensionsDir = join(installationRoot, 'extensions');
  const userDataDir = join(installationRoot, 'user-data');

  await Promise.all([mkdir(extensionsDir), mkdir(userDataDir)]);

  const vscodeExecutablePath = await downloadAndUnzipVSCode({ version: vscodeVersion });
  const installedExtension = await installPackagedVsix({
    extensionsDir,
    userDataDir,
    version: vscodeVersion,
    vsixPath: packagedVsixPath,
  });

  return {
    extensionPath: installedExtension.extensionPath,
    extensionsDir,
    installationRoot,
    vscodeExecutablePath,
  };
}

export async function disposePreparedElectronTest(prepared: PreparedElectronTest): Promise<void> {
  await disposeElectronTest(undefined, prepared.installationRoot);
}

export function resolvePackagedVsixPath(): string {
  const value = resolve(process.cwd(), 'graphics-workbench.vsix');

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
  const prepared = options.prepared;

  const temporaryRoot = await mkdtemp(join(temporaryBase, 'graphics-workbench-electron-'));
  const workspacePath = join(temporaryRoot, 'workspace');
  const userDataDir = join(temporaryRoot, 'user-data');
  const userSettingsDir = join(userDataDir, 'User');
  const userSettingsPath = join(userSettingsDir, 'settings.json');
  const sharedDataDir = join(temporaryRoot, 'shared-data');
  const extensionsDir = prepared?.extensionsDir ?? join(temporaryRoot, 'extensions');

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

  const directories = [mkdir(workspacePath), mkdir(userSettingsDir, { recursive: true }), mkdir(sharedDataDir)];
  if (!prepared) {
    directories.push(mkdir(extensionsDir));
  }
  await Promise.all(directories);

  if (copyFixtures) {
    await Promise.all([
      cp(sourceFixture, inputPath),
      cp(rasterSourceFixture, join(workspacePath, 'packaged-raster-input.png')),
    ]);
  }

  const sourceFixtureBytes = copyFixtures ? await readFile(sourceFixture) : new Uint8Array();

  await writeVscodeUserSettings(userSettingsPath, colorTheme, {
    'graphics-workbench.execPath.pdftocairo':
      process.platform === 'win32'
        ? 'C:\\graphics-workbench-missing\\pdftocairo.exe'
        : '/graphics-workbench-missing/pdftocairo',
    ...extraSettings,
  });

  const vscodeExecutablePath =
    prepared?.vscodeExecutablePath ?? (await downloadAndUnzipVSCode({ version: vscodeVersion }));
  const extensionPath =
    prepared?.extensionPath ??
    (
      await installPackagedVsix({
        extensionsDir,
        userDataDir,
        version: vscodeVersion,
        vsixPath: packagedVsixPath,
      })
    ).extensionPath;

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
    extensionPath,
    temporaryRoot,
    inputPath,
    outputPath,
    sourceFixtureBytes,
  };
}

export async function loadPackagedOperation<T>(
  extensionPath: string,
  relativePath: string,
  isModule: (value: unknown) => value is T,
): Promise<T> {
  const module: unknown = await import(pathToFileURL(join(extensionPath, relativePath)).href);
  if (!isModule(module)) {
    throw new Error(`Packaged module has an unexpected shape: ${relativePath}`);
  }
  return module;
}
