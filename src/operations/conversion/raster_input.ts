import { once } from 'node:events';

import sharp, { type Sharp } from 'sharp';

// Path-backed inputs must not remain open in libvips's file cache on Windows.
sharp.cache({ files: 0 });

export type RasterInput = Sharp;

export interface RasterAnimationMetadata {
  pages: number;
  pageHeight: number;
  delay?: number[];
  loop?: number;
}

export function openRasterInput(
  sourcePath: string,
  maxInputPixels: number,
  page?: number,
  animated = false,
): RasterInput {
  const inputOptions: Parameters<typeof sharp>[1] = {
    limitInputPixels: maxInputPixels,
    failOn: 'warning',
  };
  if (page !== undefined) {
    inputOptions.page = page - 1;
    inputOptions.pages = 1;
  } else if (animated) {
    inputOptions.animated = true;
  }
  return sharp(sourcePath, inputOptions);
}

export async function readRasterAnimationMetadata(
  sourcePath: string,
  maxInputPixels: number,
): Promise<RasterAnimationMetadata | undefined> {
  const image = openRasterInput(sourcePath, maxInputPixels, undefined, true);

  try {
    const metadata = await image.metadata();
    const pages = metadata.pages ?? 1;
    const pageHeight = metadata.pageHeight ?? metadata.height;
    if (!Number.isInteger(pages) || pages < 1 || !Number.isInteger(pageHeight) || pageHeight < 1) {
      throw new Error(`Could not determine image animation metadata: ${sourcePath}`);
    }
    if (pages <= 1) {
      return undefined;
    }

    const result: RasterAnimationMetadata = {
      pages,
      pageHeight,
    };
    if (metadata.delay !== undefined) {
      result.delay = metadata.delay;
    }
    if (metadata.loop !== undefined) {
      result.loop = metadata.loop;
    }
    return result;
  } finally {
    await destroyRasterInput(image);
  }
}

export async function destroyRasterInput(image: RasterInput): Promise<void> {
  if (image.destroyed) {
    return;
  }

  const closed = once(image, 'close');
  image.destroy();
  await closed;
}

export function isRasterInputPixelLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:pixel|pixels).{0,40}(?:limit|maximum)|(?:limit|maximum).{0,40}(?:pixel|pixels)/iu.test(message);
}

export function rasterInputPixelLimitMessage(
  maxInputPixels: number,
  dimensions?: { width: number; height: number },
): string {
  const lines = [
    'The image exceeds the configured raster input pixel limit.',
    '',
    `Configured limit: ${maxInputPixels.toLocaleString('en-US')} pixels`,
  ];

  if (dimensions !== undefined) {
    lines.push(
      '',
      `Image dimensions: ${dimensions.width} × ${dimensions.height}`,
      `Image pixels: ${(dimensions.width * dimensions.height).toLocaleString('en-US')}`,
    );
  }

  lines.push('', 'Reduce the image dimensions or increase', 'graphics-workbench.raster.maxInputPixels.');
  return lines.join('\n');
}
