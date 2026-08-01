import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

import { cropConfigureFixture } from '../../helpers/crop_configure_fixture.js';
import type { MergePdfOptions } from '../../../src/operations/pdf/merge_pdf.js';
import type { SplitPdfOptions } from '../../../src/operations/pdf/split_pdf.js';
import type { CommittedConversionOutput } from '../../../src/operations/lifecycle/commit_conversion_outputs.js';

import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import { captureCropPdfScreenshot } from './helpers/crop_pdf_screenshot.js';
import {
  expectPdfCanvasesReadable,
  expectWebviewNetworkBlocked,
  convertPdfToJpeg,
  convertPngToJpeg,
  openCropPdfConfigure,
  waitForWebviewTheme,
} from './helpers/crop_pdf_webview.js';
import {
  attachElectronDiagnostics,
  disposeElectronTest,
  writeVscodeUserSettings,
} from './helpers/vscode_electron_test.js';
import {
  disposePreparedElectronTest,
  loadPackagedOperation,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  type ElectronTestEnv,
  type PreparedElectronTest,
} from './helpers/electron_test_env.js';

const packagedVsixPath = resolvePackagedVsixPath();
const alternateTheme = 'Default Light Modern';
const additionalThemes = [
  {
    id: 'default-high-contrast',
    colorTheme: 'Default High Contrast',
    themeClass: 'vscode-high-contrast',
  },
  {
    id: 'default-high-contrast-light',
    colorTheme: 'Default High Contrast Light',
    themeClass: 'vscode-high-contrast-light',
  },
  {
    id: 'red',
    colorTheme: 'Red',
    themeClass: 'vscode-dark',
  },
  {
    id: 'abyss',
    colorTheme: 'Abyss',
    themeClass: 'vscode-dark',
  },
] as const;
const expectedCropBox = {
  x: cropConfigureFixture.cropBox.left,
  y: cropConfigureFixture.cropBox.bottom,
  width: cropConfigureFixture.cropBox.right - cropConfigureFixture.cropBox.left,
  height: cropConfigureFixture.cropBox.top - cropConfigureFixture.cropBox.bottom,
};

type PackagedMergePdfModule = {
  mergePdf(options: MergePdfOptions): Promise<unknown>;
};
type PackagedSplitPdfModule = {
  splitPdfAllPages(options: SplitPdfOptions): Promise<CommittedConversionOutput[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPackagedMergePdfModule(value: unknown): value is PackagedMergePdfModule {
  return isRecord(value) && typeof value.mergePdf === 'function';
}

function isPackagedSplitPdfModule(value: unknown): value is PackagedSplitPdfModule {
  return isRecord(value) && typeof value.splitPdfAllPages === 'function';
}

let preparedElectronTest: PreparedElectronTest | undefined;

test.beforeAll(async () => {
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

function preparedOptions(): { prepared: PreparedElectronTest } {
  if (!preparedElectronTest) {
    throw new Error('Packaged Electron test environment was not prepared.');
  }

  return { prepared: preparedElectronTest };
}

test('インストール済みVSIXからextensionをactivateできる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());

    await expect(env.app.window.getByText('Safe Mode: ON', { exact: true })).toBeVisible();
    await expect(env.app.window.getByRole('tree', { name: 'Files Explorer' })).toBeVisible();
  } catch (error) {
    await attachElectronDiagnostics({
      consoleMessages: [],
      error,
      extensionsDir: env?.directories.extensionsDir ?? '',
      sharedDataDir: env?.directories.sharedDataDir ?? '',
      temporaryRoot: env?.directories.temporaryRoot ?? '',
      testInfo,
      userDataDir: env?.directories.userDataDir ?? '',
      window: env?.app.window,
      workspacePath: env?.directories.workspacePath ?? '',
    });
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('Crop Configure Webviewを開きPDFを表示しApplyして正しいPDFを出力できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const {
      canvases,
      frame: webviewFrame,
      preview,
      settings,
    } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);

    await expect(webviewFrame.getByRole('heading', { name: 'Custom Crop', exact: true })).toBeVisible();
    await expect(webviewFrame.getByText(`${cropConfigureFixture.fileName} · 2 pages`, { exact: true })).toBeVisible();

    await expect(preview).toBeVisible();
    await expect(settings).toBeVisible();
    await expect(canvases).toHaveCount(2);
    await expect
      .poll(() =>
        canvases.evaluateAll((elements) =>
          elements.every((canvas) => {
            const bounds = canvas.getBoundingClientRect();
            return canvas.width > 0 && canvas.height > 0 && bounds.width > 0 && bounds.height > 0;
          }),
        ),
      )
      .toBe(true);
    await expect(webviewFrame.locator('.pdf-page__footer')).toHaveText(['Page 1 / 2', 'Page 2 / 2']);
    await expect(webviewFrame.getByText(/PDFを表示できませんでした:/)).toHaveCount(0);

    await expectWebviewNetworkBlocked(webviewFrame);

    await settings
      .getByRole('spinbutton', { name: 'Left', exact: true })
      .fill(cropConfigureFixture.cropBox.left.toString());
    await settings
      .getByRole('spinbutton', { name: 'Bottom', exact: true })
      .fill(cropConfigureFixture.cropBox.bottom.toString());
    await settings
      .getByRole('spinbutton', { name: 'Right', exact: true })
      .fill(cropConfigureFixture.cropBox.right.toString());
    await settings
      .getByRole('spinbutton', { name: 'Top', exact: true })
      .fill(cropConfigureFixture.cropBox.top.toString());
    await expect(settings.getByRole('radio', { name: 'All pages', exact: true })).toBeChecked();
    await expectPdfCanvasesReadable(canvases);

    await settings.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect
      .poll(async () => {
        try {
          const outputDocument = await PDFDocument.load(await readFile(env!.files.outputPath));
          return outputDocument.getPageCount();
        } catch {
          return 0;
        }
      })
      .toBe(2);

    const outputDocument = await PDFDocument.load(await readFile(env.files.outputPath));
    expect(outputDocument.getPageCount()).toBe(2);

    for (const page of outputDocument.getPages()) {
      expect(page.getMediaBox()).toEqual(expectedCropBox);
      expect(page.getCropBox()).toEqual(expectedCropBox);
    }

    expect(await readFile(env.files.inputPath)).toEqual(env.files.sourceFixtureBytes);

    const successNotification = env.app.window.getByText('Cropped 1 PDF file(s).', {
      exact: true,
    });
    await expect(successNotification).toBeVisible();
    await env.app.window.keyboard.press('Escape');
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('dark/light themeへ追従しcanvasが読める', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);

    const darkTheme = await waitForWebviewTheme(body, 'vscode-dark');
    await expectPdfCanvasesReadable(canvases);
    const darkScreenshot = await captureCropPdfScreenshot(env.app.window, body);
    await testInfo.attach('crop-pdf-configure-dark', {
      body: darkScreenshot,
      contentType: 'image/png',
    });

    expect(darkScreenshot).toMatchSnapshot('crop-pdf-configure-dark.png', {
      maxDiffPixelRatio: 0.05,
    });

    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');
    await writeVscodeUserSettings(userSettingsPath, alternateTheme);

    const lightTheme = await waitForWebviewTheme(body, 'vscode-light');
    expect(lightTheme.bodyBackground).not.toBe(darkTheme.bodyBackground);
    expect(lightTheme.bodyForeground).not.toBe(darkTheme.bodyForeground);
    await expectPdfCanvasesReadable(
      canvases,
      'PDF canvas rendering became unreadable after switching the VS Code theme.',
    );
    const lightScreenshot = await captureCropPdfScreenshot(env.app.window, body, {
      canvases,
      snapshotPrefix: join(env.directories.temporaryRoot, 'crop-pdf-light'),
    });
    await testInfo.attach('crop-pdf-configure-light', {
      body: lightScreenshot,
      contentType: 'image/png',
    });

    expect(lightScreenshot).toMatchSnapshot('crop-pdf-configure-light.png', {
      maxDiffPixelRatio: 0.05,
    });
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('high contrastと極端な配色でもcanvasが読める', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(),
      colorTheme: additionalThemes[0]?.colorTheme ?? 'Default High Contrast',
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');
    const { body, canvases } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);

    for (const theme of additionalThemes) {
      await writeVscodeUserSettings(userSettingsPath, theme.colorTheme);
      await waitForWebviewTheme(body, theme.themeClass);
      await expectPdfCanvasesReadable(canvases, `PDF canvas rendering failed for the ${theme.colorTheme} theme.`);
      const screenshot = await captureCropPdfScreenshot(env.app.window, body, {
        canvases,
        snapshotPrefix: join(env.directories.temporaryRoot, `crop-pdf-${theme.id}`),
      });
      await testInfo.attach(`crop-pdf-configure-${theme.id}`, {
        body: screenshot,
        contentType: 'image/png',
      });

      expect(screenshot).toMatchSnapshot(`crop-pdf-configure-${theme.id}.png`, {
        maxDiffPixelRatio: 0.05,
      });
    }
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('package済みmoduleでMergeが動く', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const mergedOutputPath = join(env.directories.workspacePath, 'packaged-merged.pdf');

    // Copy input fixture to output path so we have two PDFs to merge
    await writeFile(env.files.outputPath, env.files.sourceFixtureBytes);

    const mergeModule = await loadPackagedOperation<PackagedMergePdfModule>(
      env.app.extensionPath,
      'out/operations/pdf/merge_pdf.js',
      isPackagedMergePdfModule,
    );
    await mergeModule.mergePdf({
      sourcePaths: [env.files.inputPath, env.files.outputPath],
      outputPath: mergedOutputPath,
      workspacePath: env.directories.workspacePath,
      runId: 'packaged-merge',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    const mergedDocument = await PDFDocument.load(await readFile(mergedOutputPath));
    expect(mergedDocument.getPageCount()).toBe(4);
    expect(await readFile(env.files.inputPath)).toEqual(env.files.sourceFixtureBytes);
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('package済みmoduleでSplitが動く', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const splitOutputDirectory = join(env.directories.workspacePath, 'packaged-split');

    const splitModule = await loadPackagedOperation<PackagedSplitPdfModule>(
      env.app.extensionPath,
      'out/operations/pdf/split_pdf.js',
      isPackagedSplitPdfModule,
    );
    const splitOutputs = await splitModule.splitPdfAllPages({
      jobs: [
        {
          sourcePath: env.files.inputPath,
          workspacePath: env.directories.workspacePath,
          outputPathForPage: (page) => join(splitOutputDirectory, `${page}.pdf`),
        },
      ],
      runId: 'packaged-split',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    expect(splitOutputs).toHaveLength(2);
    for (const splitOutput of splitOutputs) {
      const splitDocument = await PDFDocument.load(await readFile(splitOutput.outputPath));
      expect(splitDocument.getPageCount()).toBe(1);
    }
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('native Sharp dependencyをloadしてPNG→JPEG変換できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const rasterOutputPath = join(env.directories.workspacePath, 'packaged-raster-input.jpeg');

    await convertPngToJpeg(env.app.window, 'packaged-raster-input.png');
    await expect
      .poll(async () => {
        try {
          return (await readFile(rasterOutputPath)).length > 0;
        } catch {
          return false;
        }
      })
      .toBe(true);
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('外部networkが遮断されている', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame: webviewFrame } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await expectWebviewNetworkBlocked(webviewFrame);
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('pdftocairo欠損時に期待するfailureになる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];
  const missingToolDirectory = await mkdtemp(join(tmpdir(), 'graphics-workbench-missing-pdftocairo-'));
  const missingToolPath = join(missingToolDirectory, 'pdftocairo');

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(),
      extraSettings: {
        'graphics-workbench.execPath.pdftocairo': missingToolPath,
      },
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    await convertPdfToJpeg(env.app.window, cropConfigureFixture.fileName);
    await expect(env.app.window.getByRole('alert').filter({ hasText: 'Failed to convert to JPEG:' })).toBeVisible();

    const failedPdfJpegOutputPaths = [1, 2].map((page) =>
      join(env!.directories.workspacePath, `multilingual-text-${page}.jpeg`),
    );
    for (const failedOutputPath of failedPdfJpegOutputPaths) {
      await expect
        .poll(async () => {
          try {
            await readFile(failedOutputPath);
            return false;
          } catch {
            return true;
          }
        })
        .toBe(true);
    }
    await env.app.window.keyboard.press('Escape');
  } catch (error) {
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
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
    await rm(missingToolDirectory, { recursive: true, force: true });
  }
});
