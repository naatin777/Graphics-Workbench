import {
  createPdfRenderBackend,
  executeDrawio,
  type DrawioBackend,
  type PdfRenderBackend,
} from '@graphics-workbench/core/conversion';

export const defaultRasterMaxInputPixels = 268_402_689;

export interface ConfiguredConversionTools {
  pdfRenderTools: PdfRenderBackend;
  rsvgConvertPath: string;
  drawioTools: DrawioBackend;
}

/**
 * External tool paths are injected explicitly through environment variables;
 * tests never discover tools by scanning PATH or probing the host. A suite
 * that needs a tool whose variable is unset skips itself.
 *
 * - GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH
 * - GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH
 */
export function readConfiguredConversionTools(): ConfiguredConversionTools {
  return {
    pdfRenderTools: createPdfRenderBackend(),
    rsvgConvertPath: process.env.GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH ?? '',
    drawioTools: {
      drawioPath: process.env.GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH ?? '',
      runDrawio: executeDrawio,
    },
  };
}
