import { cp } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { cropConfigureFixture } from '../../helpers/crop_configure_fixture.js';
import { operationPdfInputDirectory } from '../../helpers/fixture_paths.js';
import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import { expectPdfCanvasesReadable, waitForWebviewTheme } from './helpers/crop_pdf_webview.js';
import {
  type ElectronTestEnv,
  type PreparedElectronTest,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  disposePreparedElectronTest,
} from './helpers/electron_test_env.js';
import { captureMergePdfScreenshot, openMergePdfConfigure } from './helpers/merge_pdf_webview.js';
import {
  attachElectronDiagnostics,
  disposeElectronTest,
  writeVscodeUserSettings,
} from './helpers/vscode_electron_test.js';

const packagedVsixPath = resolvePackagedVsixPath();
const alternateTheme = 'Default Light Modern';
const secondPdfName = 'second.pdf';
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

async function addSecondPdf(workspacePath: string): Promise<void> {
  const sourceFixture = join(operationPdfInputDirectory, cropConfigureFixture.fileName);
  await cp(sourceFixture, join(workspacePath, secondPdfName));
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
    await addSecondPdf(env.directories.workspacePath);

    const { body, canvases } = await openMergePdfConfigure(env.app.window, [
      cropConfigureFixture.fileName,
      secondPdfName,
    ]);

    const darkTheme = await waitForWebviewTheme(body, 'vscode-dark');
    await expectPdfCanvasesReadable(canvases);
    const darkScreenshot = await captureMergePdfScreenshot(env.app.window, body);
    await testInfo.attach('merge-pdf-configure-dark', {
      body: darkScreenshot,
      contentType: 'image/png',
    });

    expect(darkScreenshot).toMatchSnapshot('merge-pdf-configure-dark.png', {
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
    const lightScreenshot = await captureMergePdfScreenshot(env.app.window, body);
    await testInfo.attach('merge-pdf-configure-light', {
      body: lightScreenshot,
      contentType: 'image/png',
    });

    expect(lightScreenshot).toMatchSnapshot('merge-pdf-configure-light.png', {
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
    for (const theme of additionalThemes) {
      await resetTestWorkspace();
      env = await setupElectronTest(playwright._electron, packagedVsixPath, {
        ...preparedOptions(),
        colorTheme: theme.colorTheme,
      });
      env.app.electronApp.on('console', (message) => {
        consoleMessages.push(message.text());
      });
      await addSecondPdf(env.directories.workspacePath);

      try {
        const { body, canvases } = await openMergePdfConfigure(env.app.window, [
          cropConfigureFixture.fileName,
          secondPdfName,
        ]);
        await waitForWebviewTheme(body, theme.themeClass);
        await expectPdfCanvasesReadable(canvases, `PDF canvas rendering failed for the ${theme.colorTheme} theme.`);
        const screenshot = await captureMergePdfScreenshot(env.app.window, body);
        await testInfo.attach(`merge-pdf-configure-${theme.id}`, {
          body: screenshot,
          contentType: 'image/png',
        });

        expect(screenshot).toMatchSnapshot(`merge-pdf-configure-${theme.id}.png`, {
          maxDiffPixelRatio: 0.05,
        });
      } finally {
        await disposeElectronTest(env.app.electronApp, env.directories.temporaryRoot);
        env = undefined;
        await resetTestWorkspace();
      }
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
