import { expect, type Frame, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

export interface CropPdfWebview {
  body: Locator;
  canvases: Locator;
  frame: Frame;
  preview: Locator;
  settings: Locator;
}

export interface WebviewThemeState {
  bodyBackground: string;
  bodyForeground: string;
}

export async function openCropPdfConfigure(vscodeWindow: Page, fileName: string): Promise<CropPdfWebview> {
  await expect(vscodeWindow.getByText('Safe Mode: ON', { exact: true })).toBeVisible();

  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  await expect(explorer).toBeVisible();

  const pdfEntry = explorer.getByRole('treeitem', { name: fileName });
  await expect(pdfEntry).toBeVisible();
  await selectExplorerEntry(pdfEntry);
  await pdfEntry.press('Shift+F10');

  const cropPdfMenu = vscodeWindow.getByRole('menuitem', { name: 'Crop PDF' });
  await expect(cropPdfMenu).toBeVisible();
  await cropPdfMenu.hover();
  await vscodeWindow.keyboard.press('ArrowRight');

  const configureMenu = vscodeWindow.getByRole('menuitem', { name: 'Configure crop' });
  await expect(configureMenu).toBeVisible();
  await configureMenu.hover();
  await expect(configureMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');

  let webviewFrame: Frame | undefined;
  await expect
    .poll(
      async () => {
        for (const frame of vscodeWindow.frames()) {
          const heading = frame.locator('h1').filter({ hasText: /^Custom Crop$/ });
          if ((await heading.count()) > 0) {
            webviewFrame = frame;
            return true;
          }
        }

        return false;
      },
      {
        message: 'Crop PDF Configure webview was not created.',
      },
    )
    .toBe(true);

  if (!webviewFrame) {
    throw new Error('Crop PDF Configure webview was not found after it was created.');
  }

  await expectWebviewHasNoHorizontalOverflow(webviewFrame);
  await expectWebviewPanesNotOverlapping(webviewFrame);
  await expectPdfPreviewCentered(webviewFrame);

  return {
    body: webviewFrame.locator('body'),
    canvases: webviewFrame.locator('canvas[data-pdf-page]'),
    frame: webviewFrame,
    preview: webviewFrame.getByRole('region', { name: 'PDF preview' }),
    settings: webviewFrame.getByRole('region', { name: 'Crop settings' }),
  };
}

export async function convertPngToJpeg(vscodeWindow: Page, fileName: string): Promise<void> {
  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  const pngEntry = explorer.getByRole('treeitem', { name: fileName });
  await expect(pngEntry).toBeVisible();
  await selectExplorerEntry(pngEntry);
  await pngEntry.press('Shift+F10');

  const convertMenu = vscodeWindow.getByRole('menuitem', { name: 'Convert' });
  await expect(convertMenu).toBeVisible();
  await convertMenu.hover();

  const jpegMenu = vscodeWindow.getByRole('menuitem', { name: 'JPEG' });
  await expect(jpegMenu).toBeVisible();
  await jpegMenu.hover();
  await expect(jpegMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');

  const successNotification = vscodeWindow.getByRole('alert').filter({ hasText: 'Converted 1 file(s) to JPEG.' });
  await expect(successNotification).toBeVisible();
  await vscodeWindow.keyboard.press('Escape');
}

export async function convertPdfToJpeg(vscodeWindow: Page, fileName: string): Promise<void> {
  const explorer = vscodeWindow.getByRole('tree', { name: 'Files Explorer' });
  const pdfEntry = explorer.getByRole('treeitem', { name: fileName });
  await expect(pdfEntry).toBeVisible();
  await selectExplorerEntry(pdfEntry);
  await pdfEntry.press('Shift+F10');

  const convertMenu = vscodeWindow.getByRole('menuitem', { name: 'Convert' });
  await expect(convertMenu).toBeVisible();
  await convertMenu.hover();

  const jpegMenu = vscodeWindow.getByRole('menuitem', { name: 'JPEG' });
  await expect(jpegMenu).toBeVisible();
  await jpegMenu.hover();
  await expect(jpegMenu).toBeFocused();
  await vscodeWindow.keyboard.press('Enter');
}

export async function selectExplorerEntry(entry: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await entry.getAttribute('aria-selected')) === 'true') {
          return true;
        }

        await entry.click();
        return (await entry.getAttribute('aria-selected')) === 'true';
      },
      { message: 'Explorer entry was not selected.' },
    )
    .toBe(true);
}

export async function expectWebviewHasNoHorizontalOverflow(frame: Frame): Promise<void> {
  await expect
    .poll(
      async () => {
        const [root, body] = await Promise.all(
          [frame.locator('html'), frame.locator('body')].map(async (locator) =>
            locator.evaluate((element) => ({
              clientWidth: Reflect.get(element, 'clientWidth'),
              scrollWidth: Reflect.get(element, 'scrollWidth'),
            })),
          ),
        );
        if (!root || !body) {
          return false;
        }

        const rootClientWidth = typeof root.clientWidth === 'number' ? root.clientWidth : 0;
        const rootScrollWidth = typeof root.scrollWidth === 'number' ? root.scrollWidth : 0;
        const bodyScrollWidth = typeof body.scrollWidth === 'number' ? body.scrollWidth : 0;
        return rootClientWidth > 0 && Math.max(rootScrollWidth, bodyScrollWidth) <= rootClientWidth + 1;
      },
      { message: 'Webview content must not overflow horizontally.' },
    )
    .toBe(true);
}

export async function expectWebviewPanesNotOverlapping(frame: Frame): Promise<void> {
  await expect
    .poll(
      () =>
        frame.locator('.split-pane > *').evaluateAll((elements) => {
          const rectangles = elements
            .map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                bottom: bounds.bottom,
                height: bounds.height,
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                width: bounds.width,
              };
            })
            .filter((bounds) => bounds.width > 0 && bounds.height > 0);

          return rectangles.every((current, index) =>
            rectangles.slice(index + 1).every((other) => {
              const horizontalOverlap = current.left < other.right - 1 && current.right > other.left + 1;
              const verticalOverlap = current.top < other.bottom - 1 && current.bottom > other.top + 1;
              return !(horizontalOverlap && verticalOverlap);
            }),
          );
        }),
      { message: 'Webview split panes must not overlap.' },
    )
    .toBe(true);
}

export async function expectPdfPreviewCentered(frame: Frame): Promise<void> {
  await expect
    .poll(
      async () => {
        const metrics = await frame.locator('.pdf-preview').evaluate((preview) => {
          const pages = preview.querySelector('.pdf-preview__pages');
          const canvas = preview.querySelector('canvas[data-pdf-page]');
          if (!pages || !canvas) {
            return { delta: -1, pagesWidth: 0, canvasWidth: 0 };
          }

          const pagesBounds = pages.getBoundingClientRect();
          const canvasBounds = canvas.getBoundingClientRect();
          const pagesCenter = pagesBounds.left + pagesBounds.width / 2;
          const canvasCenter = canvasBounds.left + canvasBounds.width / 2;
          return {
            delta: Math.abs(pagesCenter - canvasCenter),
            pagesWidth: pagesBounds.width,
            canvasWidth: canvasBounds.width,
          };
        });
        // Native scrollbars and the preview padding can shift the visual center by a few pixels.
        return metrics.delta >= 0 && metrics.delta <= 8;
      },
      { message: 'PDF preview pages must remain horizontally centered.' },
    )
    .toBe(true);
}

export async function expectWebviewPreviewScrollable(frame: Frame): Promise<void> {
  await expect
    .poll(
      async () => {
        const preview = frame.locator('.pdf-preview');
        const metrics = await preview.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          canScroll: (() => {
            const initialScrollTop = element.scrollTop;
            element.scrollTop = Math.min(element.scrollHeight, initialScrollTop + element.clientHeight);
            const moved = element.scrollTop > initialScrollTop;
            element.scrollTop = initialScrollTop;
            return moved;
          })(),
        }));

        return metrics.clientHeight > 0 && metrics.scrollHeight > metrics.clientHeight && metrics.canScroll;
      },
      { message: 'PDF preview must expose a vertical scroll area.' },
    )
    .toBe(true);
}

export async function renderAllPdfPreviewPages(frame: Frame): Promise<void> {
  await frame.locator('.pdf-preview').evaluate(async (element) => {
    const waitForPaint = (): Promise<void> => {
      const requestAnimationFrameValue = element.ownerDocument.defaultView?.requestAnimationFrame;

      if (!requestAnimationFrameValue) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        requestAnimationFrameValue(() => {
          requestAnimationFrameValue(() => resolve());
        });
      });
    };
    const step = Math.max(1, element.clientHeight * 0.8);

    for (let top = 0; top <= element.scrollHeight; top += step) {
      element.scrollTop = top;
      await waitForPaint();
    }

    element.scrollTop = 0;
    await waitForPaint();
  });
}

export async function expectPdfCanvasesReadable(canvases: Locator, message?: string): Promise<void> {
  await expect
    .poll(() => canvases.count(), { message: 'PDF preview must create at least one canvas.' })
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const whitePixelRatios = await captureCanvasWhitePixelRatios(canvases);
        return whitePixelRatios.every((ratio) => ratio >= 0.2 && ratio < 1);
      },
      message ? { message } : undefined,
    )
    .toBe(true);
}

export async function expectWebviewNetworkBlocked(frame: Frame): Promise<void> {
  const externalRequestSucceeded = await frame.evaluate(async () => {
    try {
      await fetch('https://example.com', { signal: AbortSignal.timeout(2_000) });
      return true;
    } catch {
      return false;
    }
  });

  expect(externalRequestSucceeded).toBe(false);
}

export async function waitForWebviewTheme(
  body: Locator,
  themeClass: 'vscode-dark' | 'vscode-light' | 'vscode-high-contrast' | 'vscode-high-contrast-light',
): Promise<WebviewThemeState> {
  await expect(body).toHaveClass(new RegExp(`(^|\\s)${themeClass}(\\s|$)`));
  const allowTransparentBackground = themeClass.startsWith('vscode-high-contrast');
  await expect
    .poll(() =>
      body.evaluate((element, allowTransparent) => {
        const isCallable = (value: unknown): value is (this: unknown, ...args: unknown[]) => unknown =>
          typeof value === 'function';
        const browserDocument = Reflect.get(globalThis, 'document');
        const getComputedStyle = Reflect.get(globalThis, 'getComputedStyle');
        if (typeof browserDocument !== 'object' || browserDocument === null || typeof getComputedStyle !== 'function') {
          return false;
        }
        const querySelector = Reflect.get(browserDocument, 'querySelector');
        const documentElement = Reflect.get(browserDocument, 'documentElement');
        if (!isCallable(querySelector) || documentElement === undefined) {
          return false;
        }
        const query = (selector: string): unknown => querySelector.call(browserDocument, selector);
        const readStyle = (target: unknown) => {
          const style: unknown = getComputedStyle.call(globalThis, target);
          if (typeof style !== 'object' || style === null) {
            return { color: '', backgroundColor: '', getPropertyValue: () => '' };
          }
          const color = Reflect.get(style, 'color');
          const backgroundColor = Reflect.get(style, 'backgroundColor');
          const getPropertyValue = Reflect.get(style, 'getPropertyValue');
          return {
            color: typeof color === 'string' ? color : '',
            backgroundColor: typeof backgroundColor === 'string' ? backgroundColor : '',
            getPropertyValue: (name: string) => {
              const value: unknown = isCallable(getPropertyValue) ? getPropertyValue.call(style, name) : undefined;
              return typeof value === 'string' ? value : '';
            },
          };
        };
        const rootStyle = readStyle(documentElement);
        const panel = query('.panel');
        const input = query('.input');
        const primaryButton = query('.button--primary');

        if (!panel || !primaryButton) {
          return false;
        }

        const requiredVariables = [
          '--vscode-foreground',
          '--vscode-editor-background',
          '--vscode-descriptionForeground',
          '--vscode-sideBar-background',
          '--vscode-button-foreground',
          '--vscode-button-background',
          '--vscode-button-secondaryForeground',
        ];
        if (input) {
          requiredVariables.push('--vscode-input-foreground', '--vscode-input-background');
        }
        if (!allowTransparent) {
          requiredVariables.push('--vscode-button-secondaryBackground');
        }
        const computedStyles = [readStyle(element), readStyle(panel), readStyle(primaryButton)];
        if (input) {
          computedStyles.push(readStyle(input));
        }
        // The redesign keeps the panel backgroundless; only foreground colors and
        // the backgrounds of real controls (body, primary button, input) must resolve.
        const backgroundRequiredStyles = [readStyle(element), readStyle(primaryButton)];
        if (input) {
          backgroundRequiredStyles.push(readStyle(input));
        }

        return (
          requiredVariables.every((variableName) => rootStyle.getPropertyValue(variableName).trim().length > 0) &&
          computedStyles.every(
            (style) => style.color.length > 0 && style.color !== 'transparent' && style.color !== 'rgba(0, 0, 0, 0)',
          ) &&
          backgroundRequiredStyles.every(
            (style) =>
              style.backgroundColor.length > 0 &&
              (allowTransparent ||
                (style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)')),
          )
        );
      }, allowTransparentBackground),
    )
    .toBe(true);

  return body.evaluate((element) => {
    const getComputedStyle = Reflect.get(globalThis, 'getComputedStyle');
    if (typeof getComputedStyle !== 'function') {
      throw new Error('Webview does not expose getComputedStyle.');
    }
    const style: unknown = getComputedStyle.call(globalThis, element);
    if (typeof style !== 'object' || style === null) {
      throw new Error('Webview returned an invalid computed style.');
    }
    const backgroundColor = Reflect.get(style, 'backgroundColor');
    const color = Reflect.get(style, 'color');
    if (typeof backgroundColor !== 'string' || typeof color !== 'string') {
      throw new Error('Webview computed style did not contain colors.');
    }
    return {
      bodyBackground: backgroundColor,
      bodyForeground: color,
    };
  });
}

async function captureCanvasWhitePixelRatios(canvases: Locator): Promise<number[]> {
  const dataUrls = await canvases.evaluateAll((elements) =>
    elements.map((element) => {
      const isDataUrlFunction = (value: unknown): value is (this: object, type: string) => unknown =>
        typeof value === 'function';
      const toDataURL = Reflect.get(element, 'toDataURL');
      if (!isDataUrlFunction(toDataURL)) {
        throw new Error('PDF preview element is not a canvas.');
      }
      const dataUrl: unknown = toDataURL.call(element, 'image/png');
      if (typeof dataUrl !== 'string') {
        throw new Error('PDF preview canvas did not return a data URL.');
      }
      return dataUrl;
    }),
  );

  return Promise.all(
    dataUrls.map(async (dataUrl) => {
      const image = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
      const { data, info } = await sharp(image)
        .flatten({ background: '#ffffff' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let whitePixelCount = 0;

      for (let offset = 0; offset < data.length; offset += info.channels) {
        const red = data[offset] ?? 0;
        const green = data[offset + 1] ?? 0;
        const blue = data[offset + 2] ?? 0;

        if (red >= 240 && green >= 240 && blue >= 240) {
          whitePixelCount += 1;
        }
      }

      return whitePixelCount / (info.width * info.height);
    }),
  );
}
