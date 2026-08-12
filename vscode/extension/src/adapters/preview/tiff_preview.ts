import { closeRasterPipeline, openRasterInput } from '@graphics-workbench/core/conversion';

export interface TiffPreviewPage {
  dataUri: string;
  width: number;
  height: number;
}

/** Reads the TIFF page count. A TIFF without a page table is treated as a single page. */
export async function readTiffPreviewPageCount(
  sourcePath: string,
  maxInputPixels: number,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const pipeline = openRasterInput(sourcePath, maxInputPixels);
  try {
    const metadata = await pipeline.metadata();
    signal?.throwIfAborted();
    const pages = metadata.pages ?? 1;
    if (!Number.isInteger(pages) || pages < 1) {
      throw new Error(`Could not determine TIFF page count: ${sourcePath}`);
    }
    return pages;
  } finally {
    await closeRasterPipeline(pipeline);
  }
}

/**
 * Renders one TIFF page to a PNG data URI. The page is downscaled when it
 * exceeds the preview canvas pixel limit so large pages stay displayable.
 */
export async function renderTiffPreviewPage(
  sourcePath: string,
  page: number,
  maxInputPixels: number,
  maxCanvasPixels: number,
  signal?: AbortSignal,
): Promise<TiffPreviewPage> {
  signal?.throwIfAborted();
  const pipeline = openRasterInput(sourcePath, maxInputPixels, page);
  try {
    const metadata = await pipeline.metadata();
    signal?.throwIfAborted();
    const { width, height } = metadata;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error(`Could not read TIFF page ${page} dimensions: ${sourcePath}`);
    }

    const png = pipeline.png();
    const area = width * height;
    if (Number.isFinite(maxCanvasPixels) && maxCanvasPixels > 0 && area > maxCanvasPixels) {
      // Floor the scaled width/height so aspect rounding never exceeds the limit.
      const scale = Math.sqrt(maxCanvasPixels / area) * 0.95;
      png.resize(Math.max(1, Math.round(width * scale)));
    }
    const buffer = await png.toBuffer();
    signal?.throwIfAborted();
    return { dataUri: `data:image/png;base64,${buffer.toString('base64')}`, width, height };
  } finally {
    await closeRasterPipeline(pipeline);
  }
}
