import { cp } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Locator, type TestInfo } from '@playwright/test';

import { cropConfigureFixture } from '../../helpers/crop_configure_fixture.js';
import { operationPdfInputDirectory } from '../../helpers/fixture_paths.js';
import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import {
  expectPdfCanvasesReadable,
  openCropPdfConfigure,
  readWebviewBodyColors,
  waitForWebviewTheme,
  type WebviewThemeState,
} from './helpers/crop_pdf_webview.js';
import {
  captureCropPdfScreenshot,
  waitForWebviewLayoutToSettle,
  waitForWebviewViewportResize,
} from './helpers/crop_pdf_screenshot.js';
import {
  type ElectronTestEnv,
  type ElectronViewportSize,
  type PreparedElectronTest,
  prepareElectronTest,
  resolvePackagedVsixPath,
  resizeElectronWindow,
  setupElectronTest,
  disposePreparedElectronTest,
  getElectronViewportWidth,
} from './helpers/electron_test_env.js';
import { captureMergePdfScreenshot, openMergePdfConfigure } from './helpers/merge_pdf_webview.js';
import { captureSplitPdfScreenshot, openSplitPdfConfigure } from './helpers/split_pdf_webview.js';
import {
  applyPreviewTheme,
  capturePreviewScreenshot,
  copyTiffPreviewFixture,
  openPreviewEditor,
  tiffPreviewFixtureFileName,
} from './helpers/preview_webview.js';
import {
  attachElectronDiagnostics,
  disposeElectronTest,
  writeVscodeUserSettings,
} from './helpers/vscode_electron_test.js';
import {
  initializeVisualReviewOutput,
  type VisualReviewViewport,
  writeVisualReviewScreenshot,
} from './helpers/visual_review.js';

const packagedVsixPath = resolvePackagedVsixPath();
const secondPdfName = 'second.pdf';
const narrowViewportSize: ElectronViewportSize = { width: 600, height: 900 };
const captureThemes = [
  { id: 'dark', colorTheme: 'Default Dark Modern', themeClass: 'vscode-dark' },
  { id: 'light', colorTheme: 'Default Light Modern', themeClass: 'vscode-light' },
  { id: 'high-contrast', colorTheme: 'Default High Contrast', themeClass: 'vscode-high-contrast' },
  { id: 'high-contrast-light', colorTheme: 'Default High Contrast Light', themeClass: 'vscode-high-contrast-light' },
  { id: 'red', colorTheme: 'Red', themeClass: 'vscode-dark' },
  { id: 'abyss', colorTheme: 'Abyss', themeClass: 'vscode-dark' },
] as const;

const previewCaptureThemes = [
  { id: 'dark', colorTheme: 'Default Dark Modern', themeClass: 'vscode-dark' },
  { id: 'light', colorTheme: 'Default Light Modern', themeClass: 'vscode-light' },
] as const;

let preparedElectronTest: PreparedElectronTest | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  void playwright;
  testInfo.setTimeout(180_000);
  await resetTestWorkspace();
  await initializeVisualReviewOutput();
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

function themeSignature(state: WebviewThemeState): string {
  return `${state.bodyBackground}|${state.bodyForeground}`;
}

/**
 * Writes the VS Code color theme, then waits until the webview has adopted both
 * the theme class and its CSS variables. Same-class transitions (for example
 * dark -> red -> abyss) keep the `vscode-dark` class, so the class check can
 * pass before the new colors are painted; the body colors are polled until the
 * previous theme's colors are actually replaced.
 */
async function applyTheme(
  userSettingsPath: string,
  theme: (typeof captureThemes)[number],
  body: Locator,
  previousState: WebviewThemeState | undefined,
): Promise<WebviewThemeState> {
  await writeVscodeUserSettings(userSettingsPath, theme.colorTheme);
  const state = await waitForWebviewTheme(body, theme.themeClass);

  if (previousState !== undefined && themeSignature(state) === themeSignature(previousState)) {
    await expect
      .poll(async () => themeSignature(await readWebviewBodyColors(body)) !== themeSignature(previousState), {
        message: `Theme switch to ${theme.colorTheme} did not replace the previous theme's colors.`,
        timeout: 30_000,
      })
      .toBe(true);
    return readWebviewBodyColors(body);
  }

  return state;
}

async function captureViewportThemes(options: {
  body: Locator;
  canvases: Locator | undefined;
  env: ElectronTestEnv;
  screen: 'crop' | 'merge' | 'split';
  userSettingsPath: string;
  viewport: VisualReviewViewport;
}): Promise<void> {
  const { body, canvases, env, screen, userSettingsPath, viewport } = options;
  let previousState: WebviewThemeState | undefined;

  for (const theme of captureThemes) {
    previousState = await applyTheme(userSettingsPath, theme, body, previousState);
    const screenshot =
      screen === 'crop' && canvases
        ? await captureCropPdfScreenshot(env.app.window, body, {
            canvases,
            snapshotPrefix: join(env.directories.temporaryRoot, `${screen}-${theme.id}`),
          })
        : screen === 'merge'
          ? await captureMergePdfScreenshot(env.app.window, body)
          : await captureSplitPdfScreenshot(env.app.window, body);
    const outputPath = await writeVisualReviewScreenshot(viewport, `${screen}-configure-${theme.id}.png`, screenshot);
    console.log(`Visual review image written: ${outputPath}`);
  }
}

async function capturePreviewThemes(options: {
  body: Locator;
  canvases: Locator;
  env: ElectronTestEnv;
  type: 'pdf' | 'tiff';
  userSettingsPath: string;
  viewport: VisualReviewViewport;
}): Promise<void> {
  const { body, canvases, env, type, userSettingsPath, viewport } = options;

  for (const theme of previewCaptureThemes) {
    await applyPreviewTheme(userSettingsPath, theme, body);
    const snapshotPrefix = join(env.directories.temporaryRoot, `${type}-preview-${theme.id}`);
    const screenshot = await capturePreviewScreenshot(env.app.window, body, canvases, { snapshotPrefix, type });
    const outputPath = await writeVisualReviewScreenshot(viewport, `${type}-preview-${theme.id}.png`, screenshot);
    console.log(`Visual review image written: ${outputPath}`);
  }
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

async function resizeToNarrow(env: ElectronTestEnv, body: Locator): Promise<void> {
  await resizeElectronWindow(env.app.electronApp, env.app.window, narrowViewportSize);
  await waitForWebviewViewportResize(body, narrowViewportSize.width);
  await waitForWebviewLayoutToSettle(body);
}

test('capture Crop PDF Configure screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(300_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    await expectPdfCanvasesReadable(canvases, 'Crop PDF preview did not render before the wide capture.');
    await captureViewportThemes({
      body,
      canvases,
      env,
      screen: 'crop',
      userSettingsPath,
      viewport: 'wide',
    });

    await resizeToNarrow(env, body);
    await expectPdfCanvasesReadable(canvases, 'Crop PDF preview did not remain readable after the narrow resize.');
    await captureViewportThemes({
      body,
      canvases,
      env,
      screen: 'crop',
      userSettingsPath,
      viewport: 'narrow',
    });
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
  testInfo.setTimeout(300_000);
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

    await captureViewportThemes({
      body,
      canvases: undefined,
      env,
      screen: 'merge',
      userSettingsPath,
      viewport: 'wide',
    });

    await resizeToNarrow(env, body);
    await captureViewportThemes({
      body,
      canvases: undefined,
      env,
      screen: 'merge',
      userSettingsPath,
      viewport: 'narrow',
    });
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
  testInfo.setTimeout(300_000);
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
    await expectPdfCanvasesReadable(frame.locator('canvas[data-pdf-page]'), 'Split PDF preview did not render.');
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    await captureViewportThemes({
      body,
      canvases: undefined,
      env,
      screen: 'split',
      userSettingsPath,
      viewport: 'wide',
    });

    await resizeToNarrow(env, body);
    await captureViewportThemes({
      body,
      canvases: undefined,
      env,
      screen: 'split',
      userSettingsPath,
      viewport: 'narrow',
    });
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('capture PDF preview screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(300_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      extraSettings: {
        'workbench.editorAssociations': {
          '*.pdf': 'graphics-workbench.pdf.preview',
        },
      },
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases } = await openPreviewEditor(env.app.window, cropConfigureFixture.fileName, {
      waitFor: 'pdf',
    });
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    await capturePreviewThemes({
      body,
      canvases,
      env,
      type: 'pdf',
      userSettingsPath,
      viewport: 'wide',
    });

    await resizeToNarrow(env, body);
    await capturePreviewThemes({
      body,
      canvases,
      env,
      type: 'pdf',
      userSettingsPath,
      viewport: 'narrow',
    });
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('capture TIFF preview screenshots for visual review', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(300_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      extraSettings: {
        'workbench.editorAssociations': {
          '*.tif': 'graphics-workbench.tiff.preview',
          '*.tiff': 'graphics-workbench.tiff.preview',
        },
      },
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    await copyTiffPreviewFixture(env.directories.workspacePath);
    const { body, canvases } = await openPreviewEditor(env.app.window, tiffPreviewFixtureFileName, {
      waitFor: 'tiff',
    });
    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');

    await capturePreviewThemes({
      body,
      canvases,
      env,
      type: 'tiff',
      userSettingsPath,
      viewport: 'wide',
    });

    await resizeToNarrow(env, body);
    await capturePreviewThemes({
      body,
      canvases,
      env,
      type: 'tiff',
      userSettingsPath,
      viewport: 'narrow',
    });
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});
