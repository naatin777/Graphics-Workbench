import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

export async function waitForWebviewFontsReady(body: Locator): Promise<void> {
  await body.evaluate(async (element) => {
    const fonts = element.ownerDocument.fonts;
    if (fonts.ready !== undefined) {
      await fonts.ready;
    }
  });
}

/** Lets layout and paint settle after fonts load so snapshots are deterministic. */
export async function settleWebviewPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const requestAnimationFrameValue = Reflect.get(globalThis, 'requestAnimationFrame');
        const isCallable = (value: unknown): value is (callback: () => void) => unknown => typeof value === 'function';
        if (!isCallable(requestAnimationFrameValue)) {
          resolve();
          return;
        }

        requestAnimationFrameValue(() => {
          requestAnimationFrameValue(resolve);
        });
      }),
  );
}

export async function waitForWebviewLayoutToSettle(body: Locator): Promise<void> {
  let previousSignature = '';
  let stableSamples = 0;

  await expect
    .poll(
      async () => {
        const signature = await body.evaluate((element) => {
          const ownerDocument = Reflect.get(element, 'ownerDocument');
          const querySelector = ownerDocument && Reflect.get(ownerDocument, 'querySelector');
          const isCallable = (value: unknown): value is (this: unknown, ...args: unknown[]) => unknown =>
            typeof value === 'function';
          if (!isCallable(querySelector)) {
            return '';
          }

          const readBounds = (target: unknown): string => {
            const getBoundingClientRect = target && Reflect.get(target, 'getBoundingClientRect');
            if (!isCallable(getBoundingClientRect)) {
              return 'missing';
            }

            const bounds = getBoundingClientRect.call(target);
            if (typeof bounds !== 'object' || bounds === null) {
              return 'missing';
            }

            return ['top', 'left', 'width', 'height', 'bottom', 'right']
              .map((property) => {
                const value = Reflect.get(bounds, property);
                return typeof value === 'number' ? Math.round(value) : 0;
              })
              .join(',');
          };

          const selectors = [
            '.app',
            '.app__header',
            '.split-pane',
            '.split-pane__left',
            '.split-pane__right',
            '.pdf-preview',
            '.pdf-preview__toolbar',
            '.pdf-preview__toolbar h2',
            '.pdf-preview__toolbar p',
            '.zoom',
            '.zoom__value',
            '.pdf-preview__pages',
            '.panel',
            '.source-grid',
            '.source-card',
            '.group-row',
          ];
          return selectors
            .map((selector) => {
              const target = querySelector.call(ownerDocument, selector);
              return `${selector}:${readBounds(target)}`;
            })
            .join('|');
        });

        if (signature === '' || signature !== previousSignature) {
          previousSignature = signature;
          stableSamples = 0;
          return false;
        }

        stableSamples += 1;
        return stableSamples >= 2;
      },
      { message: 'Webview layout did not settle.' },
    )
    .toBe(true);
}

export async function captureCropPdfScreenshot(
  page: Page,
  body: Locator,
  canvasFallback?: { canvases: Locator; snapshotPrefix: string },
): Promise<Buffer> {
  await body.evaluate((element) => {
    const document = element.ownerDocument;

    if (!document.querySelector('style[data-e2e-snapshot]')) {
      const style = document.createElement('style');
      style.dataset.e2eSnapshot = 'true';
      style.textContent =
        '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';
      document.head.append(style);
    }
  });
  await waitForWebviewFontsReady(body);
  await settleWebviewPaint(page);
  await waitForWebviewLayoutToSettle(body);
  const bodyBounds = await body.boundingBox();

  if (!bodyBounds) {
    throw new Error('Crop PDF Configure webview body has no visible bounds.');
  }

  if (!canvasFallback) {
    return page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      clip: bodyBounds,
    });
  }

  const { canvases, snapshotPrefix } = canvasFallback;
  const previewBounds = await body.locator('.pdf-preview').boundingBox();

  if (!previewBounds) {
    throw new Error('PDF preview has no visible bounds.');
  }

  const canvasImages = await Promise.all(
    (await canvases.all()).map(async (canvas) => {
      const [bounds, dataUrl] = await Promise.all([
        canvas.boundingBox(),
        canvas.evaluate((element) => {
          const isDataUrlFunction = (value: unknown): value is (this: object, type: string) => unknown =>
            typeof value === 'function';
          const toDataURL = Reflect.get(element, 'toDataURL');
          if (!isDataUrlFunction(toDataURL)) {
            throw new Error('PDF preview element is not a canvas.');
          }
          const canvasDataUrl: unknown = toDataURL.call(element, 'image/png');
          if (typeof canvasDataUrl !== 'string') {
            throw new Error('PDF preview canvas did not return a data URL.');
          }
          return canvasDataUrl;
        }),
      ]);

      if (!bounds) {
        throw new Error('A PDF canvas has no visible bounds.');
      }

      return {
        bounds,
        image: Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'),
      };
    }),
  );
  const baseScreenshotPath = `${snapshotPrefix}-base.png`;
  await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: bodyBounds,
    path: baseScreenshotPath,
  });
  const baseScreenshotBuffer = await readFile(baseScreenshotPath);
  const metadata = await sharp(baseScreenshotBuffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('VS Code Webview screenshot has no dimensions.');
  }

  const scaleX = metadata.width / bodyBounds.width;
  const scaleY = metadata.height / bodyBounds.height;
  // PlaywrightはOOPIF内のcanvasを黒く取得する場合があるため、
  // pdf.jsが実Webviewで描画したcanvasを同じ座標へ合成する。
  const overlays = await Promise.all(
    canvasImages.map(async ({ bounds, image }, index) => {
      const imageMetadata = await sharp(image).metadata();

      if (!imageMetadata.width || !imageMetadata.height) {
        throw new Error('A PDF canvas screenshot has no dimensions.');
      }

      const visibleLeft = Math.max(bounds.x, previewBounds.x);
      const visibleTop = Math.max(bounds.y, previewBounds.y);
      const visibleRight = Math.min(bounds.x + bounds.width, previewBounds.x + previewBounds.width);
      const visibleBottom = Math.min(bounds.y + bounds.height, previewBounds.y + previewBounds.height);
      const sourceLeft = Math.max(0, Math.floor(((visibleLeft - bounds.x) / bounds.width) * imageMetadata.width));
      const sourceTop = Math.max(0, Math.floor(((visibleTop - bounds.y) / bounds.height) * imageMetadata.height));
      const sourceWidth = Math.min(
        imageMetadata.width - sourceLeft,
        Math.max(1, Math.ceil(((visibleRight - visibleLeft) / bounds.width) * imageMetadata.width)),
      );
      const sourceHeight = Math.min(
        imageMetadata.height - sourceTop,
        Math.max(1, Math.ceil(((visibleBottom - visibleTop) / bounds.height) * imageMetadata.height)),
      );
      const overlayPath = `${snapshotPrefix}-canvas-${index}.png`;
      await sharp(image)
        .extract({
          left: sourceLeft,
          top: sourceTop,
          width: sourceWidth,
          height: sourceHeight,
        })
        .flatten({ background: '#ffffff' })
        .resize({
          width: Math.max(1, Math.round((visibleRight - visibleLeft) * scaleX)),
          height: Math.max(1, Math.round((visibleBottom - visibleTop) * scaleY)),
        })
        .png()
        .toFile(overlayPath);
      return {
        input: overlayPath,
        left: Math.max(0, Math.round((visibleLeft - bodyBounds.x) * scaleX)),
        top: Math.max(0, Math.round((visibleTop - bodyBounds.y) * scaleY)),
      };
    }),
  );

  return sharp(baseScreenshotBuffer).composite(overlays).png().toBuffer();
}
