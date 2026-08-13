import { expect, type Locator, type Page } from '@playwright/test';

export interface WebviewThemeState {
  bodyBackground: string;
  bodyForeground: string;
}

export type ThemeQuery = 'dark' | 'high-contrast' | undefined;

export function webviewUrl(options: { page: string; scenario?: string; theme?: ThemeQuery }): string {
  const params = new URLSearchParams({ page: options.page });
  if (options.scenario !== undefined) {
    params.set('scenario', options.scenario);
  }
  if (options.theme !== undefined) {
    params.set('theme', options.theme);
  }
  return `/?${params.toString()}`;
}

export async function readWebviewBodyColors(body: Locator): Promise<WebviewThemeState> {
  return body.evaluate((element) => {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (!style) {
      throw new Error('Webview body did not expose a computed style.');
    }
    return {
      bodyBackground: style.backgroundColor,
      bodyForeground: style.color,
    };
  });
}

export async function expectWebviewBodyTheme(
  body: Locator,
  themeClass: 'vscode-dark' | 'vscode-light' | 'vscode-high-contrast',
): Promise<WebviewThemeState> {
  await expect(body).toHaveClass(new RegExp(`(^|\\s)${themeClass}(\\s|$)`));
  return readWebviewBodyColors(body);
}

export async function expectPdfCanvasesReadable(canvases: Locator, message?: string): Promise<void> {
  await expect
    .poll(() => canvases.count(), { message: 'PDF preview must create at least one canvas.' })
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        const whitePixelRatios = await canvases.evaluateAll<HTMLCanvasElement, number[]>((elements) =>
          elements.map((canvas) => {
            const bounds = canvas.getBoundingClientRect();
            if (canvas.width <= 0 || canvas.height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
              return -1;
            }
            const context = canvas.getContext('2d');
            if (!context) {
              return -1;
            }
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            let whitePixelCount = 0;
            for (let offset = 0; offset < imageData.data.length; offset += 4) {
              const red = imageData.data[offset] ?? 0;
              const green = imageData.data[offset + 1] ?? 0;
              const blue = imageData.data[offset + 2] ?? 0;
              if (red >= 240 && green >= 240 && blue >= 240) {
                whitePixelCount += 1;
              }
            }
            return whitePixelCount / (imageData.width * imageData.height);
          }),
        );
        return whitePixelRatios.every((ratio) => ratio >= 0.2 && ratio < 1);
      },
      message ? { message } : undefined,
    )
    .toBe(true);
}

export async function expectPreviewScrollable(preview: Locator, message?: string): Promise<void> {
  await expect
    .poll(
      async () => {
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
      message ? { message } : undefined,
    )
    .toBe(true);
}

export async function renderAllPdfPreviewPages(page: Page, selector = '.pdf-preview__pages'): Promise<void> {
  await page.locator(selector).evaluate(async (element) => {
    const waitForPaint = (): Promise<void> =>
      new Promise((resolve) => {
        const requestAnimationFrameValue = element.ownerDocument.defaultView?.requestAnimationFrame;
        if (!requestAnimationFrameValue) {
          resolve();
          return;
        }
        requestAnimationFrameValue(() => {
          requestAnimationFrameValue(() => resolve());
        });
      });
    const step = Math.max(1, element.clientHeight * 0.8);

    for (let top = 0; top <= element.scrollHeight; top += step) {
      element.scrollTop = top;
      await waitForPaint();
    }

    element.scrollTop = 0;
    await waitForPaint();
  });
}

export async function settlePaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
}
