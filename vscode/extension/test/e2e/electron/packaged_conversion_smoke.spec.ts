import { readPdfPages } from '@graphics-workbench/core/testing';
import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type TestInfo } from '@playwright/test';
import sharp from 'sharp';

import { cropConfigureFixture } from '../../support/helpers/crop_configure_fixture.js';
import { operationDrawioInputDirectory } from '../../support/helpers/fixture_paths.js';
import { resetTestWorkspace } from '../../support/helpers/test_workspace.js';
import {
  convertPdfToJpeg,
  convertPngToJpeg,
  openCropPdfConfigure,
  selectExplorerEntry,
} from './helpers/crop_pdf_webview.js';
import { attachElectronDiagnostics, disposeElectronTest } from './helpers/vscode_electron_test.js';
import {
  disposePreparedElectronTest,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  getElectronViewportWidth,
  type ElectronTestEnv,
  type PreparedElectronTest,
} from './helpers/electron_test_env.js';

const packagedVsixPath = resolvePackagedVsixPath();
const unicodePdfFileName = '資料 sample.pdf';
const drawioFixtureFileName = 'unicode-page-names.drawio';
const drawioFixturePath = join(operationDrawioInputDirectory, drawioFixtureFileName);
const expectedDrawioPageCount = 3;

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

function collectConsoleMessages(env: ElectronTestEnv): string[] {
  const consoleMessages: string[] = [];
  env.app.electronApp.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  return consoleMessages;
}

async function runWithDiagnostics(
  testInfo: TestInfo,
  env: ElectronTestEnv | undefined,
  consoleMessages: string[],
  error: unknown,
): Promise<never> {
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
}

test('package済みVSIXのCrop ConfigureからHost bridgeを通してPDFを変換できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  let consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      pdfFixtureFileName: cropConfigureFixture.fileName,
    });
    consoleMessages = collectConsoleMessages(env);

    const { frame, settings } = await openCropPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await expect(frame.getByRole('heading', { name: 'Custom Crop', exact: true })).toBeVisible();

    await settings
      .getByRole('spinbutton', { name: 'Left', exact: true })
      .fill(String(cropConfigureFixture.cropBox.left));
    await settings
      .getByRole('spinbutton', { name: 'Bottom', exact: true })
      .fill(String(cropConfigureFixture.cropBox.bottom));
    await settings
      .getByRole('spinbutton', { name: 'Right', exact: true })
      .fill(String(cropConfigureFixture.cropBox.right));
    await settings.getByRole('spinbutton', { name: 'Top', exact: true }).fill(String(cropConfigureFixture.cropBox.top));
    await settings.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(env.app.window.getByText('Cropped 1 PDF file(s).', { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        try {
          return (await readPdfPages(await readFile(env!.files.outputPath))).length;
        } catch {
          return 0;
        }
      })
      .toBe(2);
    const outputPages = await readPdfPages(await readFile(env.files.outputPath));
    const inputPages = await readPdfPages(await readFile(env.files.inputPath));
    expect(outputPages.length).toBe(2);
    for (const [index, page] of outputPages.entries()) {
      expect(page.mediaBox).toEqual(inputPages[index]?.mediaBox);
      expect(page.cropBox).toEqual({
        x: cropConfigureFixture.cropBox.left,
        y: cropConfigureFixture.cropBox.bottom,
        width: cropConfigureFixture.cropBox.right - cropConfigureFixture.cropBox.left,
        height: cropConfigureFixture.cropBox.top - cropConfigureFixture.cropBox.bottom,
      });
    }
    await env.app.window.keyboard.press('Escape');
  } catch (error) {
    await runWithDiagnostics(testInfo, env, consoleMessages, error);
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('package済みVSIXのSharp native dependencyでPNGをJPEGへ変換できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  let consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    consoleMessages = collectConsoleMessages(env);

    const outputPath = join(env.directories.workspacePath, 'packaged-raster-input.jpeg');
    await convertPngToJpeg(env.app.window, 'packaged-raster-input.png');

    await expect
      .poll(async () => {
        try {
          const metadata = await sharp(outputPath).metadata();
          return metadata.format === 'jpeg' && (metadata.width ?? 0) > 0 && (metadata.height ?? 0) > 0;
        } catch {
          return false;
        }
      })
      .toBe(true);
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  } catch (error) {
    await runWithDiagnostics(testInfo, env, consoleMessages, error);
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('package済みVSIXからMuPDFでPDFをJPEGへ変換できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  let consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    consoleMessages = collectConsoleMessages(env);

    const unicodeInputPath = join(env.directories.workspacePath, unicodePdfFileName);
    await cp(env.files.inputPath, unicodeInputPath);

    const expectedPageCount = (await readPdfPages(await readFile(unicodeInputPath))).length;
    await convertPdfToJpeg(env.app.window, unicodePdfFileName);

    await expect(
      env.app.window.getByRole('alert').filter({ hasText: `Converted ${expectedPageCount} file(s) to JPEG.` }),
    ).toBeVisible();
    await env.app.window.keyboard.press('Escape');

    const basename = unicodePdfFileName.replace(/\.pdf$/iu, '');
    await expect
      .poll(async () => {
        try {
          const metadata = await Promise.all(
            Array.from({ length: expectedPageCount }, (_, index) =>
              sharp(join(env!.directories.workspacePath, basename, `${index + 1}.jpeg`)).metadata(),
            ),
          );
          return metadata.every((page) => page.format === 'jpeg' && (page.width ?? 0) > 0 && (page.height ?? 0) > 0);
        } catch {
          return false;
        }
      })
      .toBe(true);
    for (let page = 1; page <= expectedPageCount; page += 1) {
      const outputPath = join(env.directories.workspacePath, basename, `${page}.jpeg`);
      const metadata = await sharp(outputPath).metadata();
      expect(metadata.format).toBe('jpeg');
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
    }
  } catch (error) {
    await runWithDiagnostics(testInfo, env, consoleMessages, error);
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('package済みVSIXからDraw.io CLIでDraw.ioをPDFへ変換できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(180_000);
  let env: ElectronTestEnv | undefined;
  let consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    consoleMessages = collectConsoleMessages(env);

    await cp(drawioFixturePath, join(env.directories.workspacePath, drawioFixtureFileName));

    const explorer = env.app.window.getByRole('tree', { name: 'Files Explorer' });
    const drawioEntry = explorer.getByRole('treeitem', { name: drawioFixtureFileName });
    await expect(drawioEntry).toBeVisible();
    await selectExplorerEntry(drawioEntry);
    await drawioEntry.press('Shift+F10');

    const directPdfMenu = env.app.window.getByRole('menuitem', {
      name: 'Convert all Draw.io pages to one PDF',
    });
    await expect(directPdfMenu).toBeVisible();
    await directPdfMenu.hover();
    await expect(directPdfMenu).toBeFocused();
    await env.app.window.keyboard.press('Enter');

    await expect(
      env.app.window.getByRole('alert').filter({ hasText: 'Converted 1 Draw.io file(s) to one PDF each.' }),
    ).toBeVisible({ timeout: 60_000 });

    const outputPath = join(env.directories.workspacePath, `${drawioFixtureFileName.replace(/\.drawio$/u, '')}.pdf`);
    await expect
      .poll(
        async () => {
          try {
            const outputPages = await readPdfPages(await readFile(outputPath));
            return outputPages.length === expectedDrawioPageCount;
          } catch {
            return false;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const outputPages = await readPdfPages(await readFile(outputPath));
    expect(outputPages.length).toBe(expectedDrawioPageCount);
    await env.app.window.keyboard.press('Escape');
  } catch (error) {
    await runWithDiagnostics(testInfo, env, consoleMessages, error);
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});
