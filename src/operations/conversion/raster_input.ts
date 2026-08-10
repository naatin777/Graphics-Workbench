import { once } from 'node:events';
import path from 'node:path';

import sharp, { type Metadata, type Sharp } from 'sharp';

// Path-backed inputs must not remain open in libvips's file cache on Windows.
sharp.cache({ files: 0 });

export type RasterPipeline = Sharp;

export interface RasterAnimationMetadata {
  pages: number;
  width?: number;
  pageHeight: number;
  delay?: number[];
  loop?: number;
}

export function openRasterInput(
  sourcePath: string,
  maxInputPixels: number,
  page?: number,
  animated = false,
): RasterPipeline {
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
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tif' || extension === '.tiff') {
    // TIFF page dimensions are allowed to differ. Reading the header without
    // `animated` avoids asking libvips to assemble incompatible pages.
    return readRasterAnimationMetadataFromIndependentPages(sourcePath, maxInputPixels);
  }

  let pipeline: RasterPipeline | undefined;

  try {
    pipeline = openRasterInput(sourcePath, maxInputPixels, undefined, true);
    const metadata = await pipeline.metadata();
    return animationMetadataFromSharpMetadata(metadata, sourcePath);
  } catch (error) {
    if (!isRasterPageDimensionError(error)) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    // libvips cannot create one animated image when TIFF pages have different
    // dimensions. The pages can still be decoded independently with `page`,
    // so use the non-animated header reader to preserve the page count.
    return await readRasterAnimationMetadataFromIndependentPages(sourcePath, maxInputPixels);
  } finally {
    if (pipeline !== undefined) {
      await closeRasterPipeline(pipeline);
    }
  }
}

function animationMetadataFromSharpMetadata(
  metadata: Metadata,
  sourcePath: string,
): RasterAnimationMetadata | undefined {
  const pages = metadata.pages ?? 1;
  const { width } = metadata;
  const pageHeight = metadata.pageHeight ?? metadata.height;
  if (
    !Number.isInteger(pages) ||
    pages < 1 ||
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(pageHeight) ||
    pageHeight < 1
  ) {
    throw new Error(`Could not determine image animation metadata: ${sourcePath}`);
  }
  if (pages <= 1) {
    return undefined;
  }

  const result: RasterAnimationMetadata = {
    pages,
    width,
    pageHeight,
  };
  if (metadata.delay !== undefined) {
    result.delay = metadata.delay;
  }
  if (metadata.loop !== undefined) {
    result.loop = metadata.loop;
  }
  return result;
}

async function readRasterAnimationMetadataFromIndependentPages(
  sourcePath: string,
  maxInputPixels: number,
): Promise<RasterAnimationMetadata | undefined> {
  const pipeline = openRasterInput(sourcePath, maxInputPixels);
  try {
    const metadata = await pipeline.metadata();
    return animationMetadataFromSharpMetadata(metadata, sourcePath);
  } finally {
    await closeRasterPipeline(pipeline);
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- エラー検証: catchが投げる値は任意の型を取り得る。
function isRasterPageDimensionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /page\s+\d+\s+differs\s+from\s+page\s+\d+|pages?\s+(?:have|has)\s+different\s+(?:dimensions|sizes)/iu.test(
    message,
  );
}

export async function closeRasterPipeline(pipeline: RasterPipeline): Promise<void> {
  if (pipeline.destroyed) {
    return;
  }

  const closed = once(pipeline, 'close');
  pipeline.destroy();
  await closed;
}

// oxlint-disable-next-line typescript/no-restricted-types -- エラー検証: catchが投げる値は任意の型を取り得る。
export function isRasterInputPixelLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:pixel|pixels).{0,40}(?:limit|maximum)|(?:limit|maximum).{0,40}(?:pixel|pixels)/iu.test(message);
}

export function formatRasterInputPixelLimitMessage(
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
