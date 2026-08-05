import { expect, test, type ElectronApplication, type TestInfo } from '@playwright/test';

import { resetTestWorkspace } from '../../helpers/test_workspace.js';
import { attachElectronDiagnostics, disposeElectronTest } from './helpers/vscode_electron_test.js';
import {
  disposePreparedElectronTest,
  getElectronViewportWidth,
  prepareElectronTest,
  resolvePackagedVsixPath,
  setupElectronTest,
  type ElectronTestEnv,
  type PreparedElectronTest,
} from './helpers/electron_test_env.js';
import { openReorderPdfConfigure, openRotatePdfConfigure } from './helpers/rotate_reorder_pdf_webview.js';

const packagedVsixPath = resolvePackagedVsixPath();
const fixtureFileName = 'multi-page-mixed-content.pdf';

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

async function withElectron(
  electron: {
    launch: (options: { executablePath: string; cwd: string; args: string[] }) => Promise<ElectronApplication>;
  },
  testInfo: TestInfo,
  run: (env: ElectronTestEnv) => Promise<void>,
): Promise<void> {
  testInfo.setTimeout(120_000);
  let env: ElectronTestEnv | undefined;
  const consoleMessages: string[] = [];

  try {
    env = await setupElectronTest(electron, packagedVsixPath, {
      ...preparedOptions(testInfo),
      pdfFixtureFileName: fixtureFileName,
    });
    env.app.electronApp.on('console', (message) => {
      consoleMessages.push(message.text());
    });

    await run(env);
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
}

test('Rotate Configureで選択pageにborder/outlineが表示される', async ({ playwright }, testInfo) => {
  await withElectron(playwright._electron, testInfo, async (env) => {
    const { frame, pages } = await openRotatePdfConfigure(env.app.window, fixtureFileName);

    await expect(pages).not.toHaveCount(0);
    const firstPage = pages.first();

    const selectedBorderColor = await firstPage.evaluate(() => {
      const documentElement = Reflect.get(globalThis, 'document');
      const getComputedStyleValue = Reflect.get(globalThis, 'getComputedStyle');
      if (
        typeof documentElement !== 'object' ||
        documentElement === null ||
        typeof getComputedStyleValue !== 'function'
      ) {
        return '';
      }
      const querySelector = Reflect.get(documentElement, 'querySelector');
      if (typeof querySelector !== 'function') {
        return '';
      }
      const pageElement = querySelector.call(documentElement, '.rotate__pages [data-pdf-page]');
      const style = getComputedStyleValue.call(globalThis, pageElement);
      const borderColor = typeof style === 'object' && style !== null ? Reflect.get(style, 'borderColor') : '';
      return typeof borderColor === 'string' ? borderColor : '';
    });

    expect(selectedBorderColor).not.toBe('transparent');
    expect(selectedBorderColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(selectedBorderColor).not.toBe('');

    await firstPage.click();
    await expect
      .poll(() => firstPage.evaluate((element) => element.classList.contains('pdf-page--selected')))
      .toBe(true);

    const selectedStyle = await firstPage.evaluate((element) => {
      const getComputedStyleValue = Reflect.get(globalThis, 'getComputedStyle');
      if (typeof getComputedStyleValue !== 'function') {
        return { borderColor: '', outline: '' };
      }
      const style = getComputedStyleValue.call(globalThis, element);
      if (typeof style !== 'object' || style === null) {
        return { borderColor: '', outline: '' };
      }
      const borderColor = Reflect.get(style, 'borderColor');
      const outline = Reflect.get(style, 'outline');
      return {
        borderColor: typeof borderColor === 'string' ? borderColor : '',
        outline: typeof outline === 'string' ? outline : '',
      };
    });
    expect(selectedStyle.borderColor).not.toBe('transparent');
    expect(selectedStyle.outline).not.toBe('none');

    await expect(frame.getByText(/\d+\/\d+/u)).toBeVisible();
  });
});

test('Reorder Configureのcontrolが対応page内に配置され、複数pageで重ならない', async ({ playwright }, testInfo) => {
  await withElectron(playwright._electron, testInfo, async (env) => {
    const { frame, pages } = await openReorderPdfConfigure(env.app.window, fixtureFileName);

    const pageCount = await pages.count();
    expect(pageCount).toBeGreaterThan(1);

    for (const page of await pages.all()) {
      const controls = page.locator('.reorder-page__controls');
      await expect(controls).toHaveCount(1);
    }

    await expect
      .poll(async () => {
        const layouts = await pages.evaluateAll((elements) =>
          elements.map((element) => {
            const pageRect = element.getBoundingClientRect();
            const controlRect = element.querySelector('.reorder-page__controls')?.getBoundingClientRect();
            if (!controlRect) {
              return { contained: false };
            }
            return {
              contained:
                controlRect.top >= pageRect.top &&
                controlRect.bottom <= pageRect.bottom &&
                controlRect.left >= pageRect.left &&
                controlRect.right <= pageRect.right,
              left: controlRect.left,
              right: controlRect.right,
              top: controlRect.top,
              bottom: controlRect.bottom,
            };
          }),
        );

        const contained = layouts.every((layout) => layout.contained);
        const overlaps = layouts.some((current, index) =>
          layouts.slice(index + 1).some((other) => {
            if (
              current.left === undefined ||
              current.right === undefined ||
              current.top === undefined ||
              current.bottom === undefined ||
              other.left === undefined ||
              other.right === undefined ||
              other.top === undefined ||
              other.bottom === undefined
            ) {
              return false;
            }
            const horizontalOverlap = current.left < other.right - 1 && current.right > other.left + 1;
            const verticalOverlap = current.top < other.bottom - 1 && current.bottom > other.top + 1;
            return horizontalOverlap && verticalOverlap;
          }),
        );

        return contained && !overlaps;
      })
      .toBe(true);

    await frame.locator('.reorder-page__move-up').first().click();
    await expect
      .poll(async () => {
        const order = await pages.evaluateAll((elements) => elements.map((element) => element.dataset.pdfPage));
        return JSON.stringify(order) !== JSON.stringify(['1', '2', '3', '4']);
      })
      .toBe(true);
  });
});
