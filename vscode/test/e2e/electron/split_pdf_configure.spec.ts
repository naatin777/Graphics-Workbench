import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, type Frame, type TestInfo } from '@playwright/test';
import { PDFDocument } from '../../support/helpers/pdf_document.js';

import { cropConfigureFixture } from '../../support/helpers/crop_configure_fixture.js';
import { resetTestWorkspace } from '../../support/helpers/test_workspace.js';
import {
  expectPdfCanvasesReadable,
  expectPdfPreviewCentered,
  expectWebviewPreviewScrollable,
  waitForWebviewTheme,
} from './helpers/crop_pdf_webview.js';
import {
  attachElectronDiagnostics,
  disposeElectronTest,
  writeVscodeUserSettings,
} from './helpers/vscode_electron_test.js';
import {
  type ElectronTestEnv,
  type PreparedElectronTest,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  disposePreparedElectronTest,
  getElectronViewportWidth,
} from './helpers/electron_test_env.js';
import { openSplitPdfConfigure } from './helpers/split_pdf_webview.js';

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

async function selectFirstSplitPage(frame: Frame): Promise<void> {
  await frame.getByRole('textbox', { name: 'Pages 1', exact: true }).fill('1');
  await frame.getByRole('button', { name: 'All pages', exact: true }).click();
  await expectPdfPreviewCentered(frame);
}

test('dark/light themeへ追従しcanvasが読める', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases, frame } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await selectFirstSplitPage(frame);

    const darkTheme = await waitForWebviewTheme(body, 'vscode-dark');
    await expectPdfCanvasesReadable(canvases);

    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');
    await writeVscodeUserSettings(userSettingsPath, alternateTheme);

    const lightTheme = await waitForWebviewTheme(body, 'vscode-light');
    expect(lightTheme.bodyBackground).not.toBe(darkTheme.bodyBackground);
    expect(lightTheme.bodyForeground).not.toBe(darkTheme.bodyForeground);
    await expectPdfCanvasesReadable(
      canvases,
      'PDF canvas rendering became unreadable after switching the VS Code theme.',
    );
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('high contrastと極端な配色でもcanvasが読める', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      colorTheme: additionalThemes[0]?.colorTheme ?? 'Default High Contrast',
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });
    env.app.window.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const userSettingsPath = join(env.directories.userDataDir, 'User', 'settings.json');
    const { body, canvases, frame } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await selectFirstSplitPage(frame);

    for (const theme of additionalThemes) {
      await writeVscodeUserSettings(userSettingsPath, theme.colorTheme);
      await waitForWebviewTheme(body, theme.themeClass);
      await expectPdfCanvasesReadable(canvases, `PDF canvas rendering failed for the ${theme.colorTheme} theme.`);
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

test('PDFプレビューのズーム入力とCtrlまたはCommandホイールが動作する', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      pdfFixtureFileName: 'multi-page-mixed-content.pdf',
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame, canvases, preview } = await openSplitPdfConfigure(env.app.window, 'multi-page-mixed-content.pdf');
    await selectFirstSplitPage(frame);
    await expect(canvases).toHaveCount(15);
    await expectWebviewPreviewScrollable(frame);

    const numericZoom = frame.locator('input[type="number"][aria-label="Preview zoom"]');
    const rangeZoom = frame.locator('input[type="range"][aria-label="Preview zoom"]');
    const initialCanvasWidth = await canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width);

    await preview.evaluate((element) => {
      element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, 180);
    });
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await numericZoom.fill('200');
    await expect(numericZoom).toHaveValue('200');
    await expect(rangeZoom).toHaveValue('200');
    await expect
      .poll(() => canvases.first().evaluate((canvas) => canvas.getBoundingClientRect().width))
      .toBeGreaterThan(initialCanvasWidth);
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await preview.hover();
    await env.app.window.keyboard.down(modifierKey);
    try {
      await env.app.window.mouse.wheel(0, -100);
    } finally {
      await env.app.window.keyboard.up(modifierKey);
    }
    await expect(numericZoom).toHaveValue('205');
    await expect(rangeZoom).toHaveValue('205');
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('分割ペインが幅に応じて配置され長幅でドラッグ調整できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame, preview } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await expect(preview).toBeVisible();

    const divider = frame.locator('.split-pane__divider');

    if (getElectronViewportWidth(testInfo) <= 900) {
      await expect
        .poll(async () => {
          const style = await frame
            .locator('.split-pane')
            .evaluate((element) => element.ownerDocument.defaultView?.getComputedStyle(element));
          return style?.flexDirection === 'column';
        })
        .toBe(true);
      await expect(divider).toBeHidden();
      return;
    }

    await expect(divider).toBeVisible();
    const dividerBox = await divider.boundingBox();

    if (!dividerBox) {
      throw new Error('Split divider has no visible bounds.');
    }

    const beforeWidth = await preview.evaluate((element) => element.getBoundingClientRect().width);
    const dividerCenterX = dividerBox.x + dividerBox.width / 2;
    const dividerCenterY = dividerBox.y + dividerBox.height / 2;

    await env.app.window.mouse.move(dividerCenterX, dividerCenterY);
    await env.app.window.mouse.down();
    await env.app.window.mouse.move(dividerCenterX - 120, dividerCenterY, { steps: 5 });
    await env.app.window.mouse.up();

    await expect
      .poll(async () => (await preview.evaluate((element) => element.getBoundingClientRect().width)) < beforeWidth)
      .toBe(true);

    const afterWidth = await preview.evaluate((element) => element.getBoundingClientRect().width);
    expect(afterWidth).toBeLessThan(beforeWidth);
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('グループ入力中にフォーカスを維持する', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions(testInfo));
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    const pages = frame.getByRole('textbox', { name: 'Pages 1', exact: true });
    const outputName = frame.getByRole('textbox', { name: 'Output name 1', exact: true });

    await pages.fill('1-2');
    await expect.poll(() => pages.evaluate((element) => element.ownerDocument.activeElement === element)).toBe(true);
    await expect(outputName).toHaveValue('1-2');
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});

test('入力したグループ設定でSplit PDFを実行できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      pdfFixtureFileName: 'multi-page-mixed-content.pdf',
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame } = await openSplitPdfConfigure(env.app.window, 'multi-page-mixed-content.pdf');
    const pages = frame.getByRole('textbox', { name: 'Pages 1', exact: true });
    const outputName = frame.getByRole('textbox', { name: 'Output name 1', exact: true });
    const outputPath = join(env.directories.workspacePath, 'multi-page-mixed-content', 'selected-pages.pdf');

    await pages.fill('1, 10-12');
    await expect(outputName).toHaveValue('1, 10-12');
    await outputName.fill('selected-pages');
    await frame.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect(env.app.window.getByText('Created 1 split PDF file(s).', { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        try {
          return (await PDFDocument.load(await readFile(outputPath))).getPageCount();
        } catch {
          return 0;
        }
      })
      .toBe(4);
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});
