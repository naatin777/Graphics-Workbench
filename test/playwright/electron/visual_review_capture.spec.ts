import { cp } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Locator, type TestInfo } from '@playwright/test';

import { cropConfigureFixture } from '../../helpers/crop_configure_fixture.js';
import { operationPdfInputDirectory } from '../../helpers/fixture_paths.js';
import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import { openCropPdfConfigure, waitForWebviewTheme } from './helpers/crop_pdf_webview.js';
import { captureCropPdfScreenshot } from './helpers/crop_pdf_screenshot.js';
import {
  type ElectronTestEnv,
  type PreparedElectronTest,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  disposePreparedElectronTest,
  getElectronViewportWidth,
} from './helpers/electron_test_env.js';
import { captureMergePdfScreenshot, openMergePdfConfigure } from './helpers/merge_pdf_webview.js';
import { captureSplitPdfScreenshot, openSplitPdfConfigure } from './helpers/split_pdf_webview.js';
import {
  attachElectronDiagnostics,
  disposeElectronTest,
  writeVscodeUserSettings,
} from './helpers/vscode_electron_test.js';
import { writeVisualReviewScreenshot } from './helpers/visual_review.js';

const packagedVsixPath = resolvePackagedVsixPath();
const secondPdfName = 'second.pdf';
const captureThemes = [
  { id: 'dark', colorTheme: 'Default Dark Modern', themeClass: 'vscode-dark' },
  { id: 'light', colorTheme: 'Default Light Modern', themeClass: 'vscode-light' },
  { id: 'high-contrast', colorTheme: 'Default High Contrast', themeClass: 'vscode-high-contrast' },
  { id: 'high-contrast-light', colorTheme: 'Default High Contrast Light', themeClass: 'vscode-high-contrast-light' },
  { id: 'red', colorTheme: 'Red', themeClass: 'vscode-dark' },
  { id: 'abyss', colorTheme: 'Abyss', themeClass: 'vscode-dark' },
] as const;

let preparedElectronTest: PreparedElectronTest | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  void playwright;
  testInfo.setTimeout(180_000);
  await resetTestWorkspace();
  preparedElectronTest = await prepareElectronTest(packagedVsixPath);
});

test.afterAll(async () => {
  try {
    if (preparedElectronTest) {
      await disposePreparedElectronTest(preparedElectronTest);
      preparedElectronTest = undefined;
    }
  } finally {
    await resetTestWorkspace();
  }
});

test.beforeEach(async () => {
  await resetTestWorkspace();
});

test.afterEach(async () => {
  await resetTestWorkspace();
});

function preparedOptions(testInfo: TestInfo): { prepared: PreparedElectronTest; viewportWidth: number } {
  if (!preparedElectronTest) {
    throw new Error('Packaged Electron test environment was not prepared.');
  }

  return { prepared: preparedElectronTest, viewportWidth: getElectronViewportWidth(testInfo) };
}

async function addSecondPdf(workspacePath: string): Promise<void> {
  const sourceFixture = join(operationPdfInputDirectory, cropConfigureFixture.fileName);
  await cp(sourceFixture, join(workspacePath, secondPdfName));
}

async function applyTheme(
  userSettingsPath: string,
  theme: (typeof captureThemes)[number],
  body: Locator,
): Promise<void> {
  if (theme.colorTheme !== 'Default Dark Modern') {
    await writeVscodeUserSettings(userSettingsPath, theme.colorTheme);
  }
  await waitForWebviewTheme(body, theme.themeClass);
}

async function attachDiagnostics(
  testInfo: TestInfo,
  env: ElectronTestEnv | undefined,
  error: unknown,
  consoleMessages: string[],
): Promise<void> {
  await attachElectronDiagnostics({
    consoleMessages,
    error,
    extensionsDir: env?.directories.extensionsDir ?? '',
    sharedDataDir: env?.directories.sharedDataDir ?? '',
    temporaryRoot: env?.directories.temporaryRoot ?? '',
    testInfo,
    userDataDir: env?.directories.userDataDir ?? '',
    window: env?.app.window,
    workspacePath: env?.directories.workspacePath ?? '',
  });
}

test('capture Crop PDF Configure screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    for (const theme of captureThemes) {
      await applyTheme(userSettingsPath, theme, body);
      const screenshot = await captureCropPdfScreenshot(env.app.window, body, {
        canvases,
        snapshotPrefix: join(env.directories.temporaryRoot, `crop-${theme.id}`),
      });
      const outputPath = await writeVisualReviewScreenshot(`crop-configure-${theme.id}.png`, screenshot);
      console.log(`Visual review image written: ${outputPath}`);
    }
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('capture Merge PDF Configure screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });
    await addSecondPdf(env.directories.workspacePath);

    const { body } = await openMergePdfConfigure(env.app.window, [cropConfigureFixture.fileName, secondPdfName]);
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    for (const theme of captureThemes) {
      await applyTheme(userSettingsPath, theme, body);
      const screenshot = await captureMergePdfScreenshot(env.app.window, body);
      const outputPath = await writeVisualReviewScreenshot(`merge-configure-${theme.id}.png`, screenshot);
      console.log(`Visual review image written: ${outputPath}`);
    }
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('capture Split PDF Configure screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, frame } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await frame.getByRole('textbox', { name: 'Pages 1', exact: true }).fill('1');
    await frame.getByRole('button', { name: 'All pages', exact: true }).click();
    await expect(frame.locator('.pdf-preview')).toBeVisible();
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    for (const theme of captureThemes) {
      await applyTheme(userSettingsPath, theme, body);
      const screenshot = await captureSplitPdfScreenshot(env.app.window, body);
      const outputPath = await writeVisualReviewScreenshot(`split-configure-${theme.id}.png`, screenshot);
      console.log(`Visual review image written: ${outputPath}`);
    }
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});
