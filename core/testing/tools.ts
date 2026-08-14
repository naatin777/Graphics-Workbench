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
 * tests never discover tools by scanning PATH or probing the host. The
 * variables are loaded from .env.test.local (via --env-file-if-exists) or
 * supplied by CI; an unset variable fails the suite with a configuration
 * error instead of silently skipping.
 *
 * - GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH
 * - GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH
 * - GRAPHICS_WORKBENCH_TEST_CHROME_PATH
 */
export function requireConfiguredTool(environmentVariable: string, toolName: string): string {
  const configured = process.env[environmentVariable];
  if (configured === undefined || configured === '') {
    throw new Error(
      [
        `${environmentVariable} is required for the ${toolName} integration tests.`,
        `Configure it in .env.test.local. See .env.test.example.`,
      ].join('\n'),
    );
  }
  return configured;
}

/**
 * The single environment→product-settings bootstrap for integration tests.
 * The env variables are the only source of external tool paths; production
 * code never reads them. Values already set in the process environment take
 * precedence over .env.test.local (loaded via --env-file-if-exists).
 */
export function readExternalTestSettings(): Record<string, string> {
  return {
    'graphics-workbench.execPath.rsvgConvert': requireConfiguredTool(
      'GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH',
      'rsvg-convert',
    ),
    'graphics-workbench.execPath.drawio': requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io'),
    'graphics-workbench.execPath.chrome': requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_CHROME_PATH', 'Chrome'),
  };
}

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
