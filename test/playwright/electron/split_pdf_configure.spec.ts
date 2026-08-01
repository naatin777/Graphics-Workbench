import { join } from 'node:path';

import { expect, test, type TestInfo } from '@playwright/test';

import { cropConfigureFixture } from '../../helpers/crop_configure_fixture.js';
import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import { expectPdfCanvasesReadable, waitForWebviewTheme } from './helpers/crop_pdf_webview.js';
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
} from './helpers/electron_test_env.js';
import { captureSplitPdfScreenshot, openSplitPdfConfigure } from './helpers/split_pdf_webview.js';

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

test('dark/light themeへ追従しcanvasが読める', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { body, canvases } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);

    const darkTheme = await waitForWebviewTheme(body, 'vscode-dark');
    await expectPdfCanvasesReadable(canvases);
    const darkScreenshot = await captureSplitPdfScreenshot(env.app.window, body);
    await testInfo.attach('split-pdf-configure-dark', {
      body: darkScreenshot,
      contentType: 'image/png',
    });

    expect(darkScreenshot).toMatchSnapshot('split-pdf-configure-dark.png', {
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
    const lightScreenshot = await captureSplitPdfScreenshot(env.app.window, body);
    await testInfo.attach('split-pdf-configure-light', {
      body: lightScreenshot,
      contentType: 'image/png',
    });

    expect(lightScreenshot).toMatchSnapshot('split-pdf-configure-light.png', {
      maxDiffPixelRatio: 0.05,
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
    const { body, canvases } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);

    for (const theme of additionalThemes) {
      await writeVscodeUserSettings(userSettingsPath, theme.colorTheme);
      await waitForWebviewTheme(body, theme.themeClass);
      await expectPdfCanvasesReadable(canvases, `PDF canvas rendering failed for the ${theme.colorTheme} theme.`);
      const screenshot = await captureSplitPdfScreenshot(env.app.window, body);
      await testInfo.attach(`split-pdf-configure-${theme.id}`, {
        body: screenshot,
        contentType: 'image/png',
      });

      expect(screenshot).toMatchSnapshot(`split-pdf-configure-${theme.id}.png`, {
        maxDiffPixelRatio: 0.05,
      });
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

test('分割ペインをドラッグで幅を調整できる', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame, preview } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    await expect(preview).toBeVisible();

    const divider = frame.locator('.split-pane__divider');
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

test('横幅が短いと縦に折り返して分割線を隠す', async ({ playwright }, testInfo) => {
  testInfo.setTimeout(240_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(playwright._electron, packagedVsixPath, preparedOptions());
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    const { frame } = await openSplitPdfConfigure(env.app.window, cropConfigureFixture.fileName);
    const splitPane = frame.locator('.split-pane');
    const divider = frame.locator('.split-pane__divider');
    await expect(splitPane).toBeVisible();

    await env.app.window.setViewportSize({ width: 600, height: 900 });
    await expect
      .poll(async () => {
        const style = await splitPane.evaluate((element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element),
        );
        return style?.flexDirection === 'column';
      })
      .toBe(true);
    await expect(divider).toBeHidden();

    await env.app.window.setViewportSize({ width: 1280, height: 900 });
    await expect
      .poll(async () => {
        const style = await splitPane.evaluate((element) =>
          element.ownerDocument.defaultView?.getComputedStyle(element),
        );
        return style?.flexDirection === 'row';
      })
      .toBe(true);
    await expect(divider).toBeVisible();
  } catch (error) {
    await attachDiagnostics(testInfo, env, error, consoleMessages);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    if (env) {
      await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
    }
  }
});
