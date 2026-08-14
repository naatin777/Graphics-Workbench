import type { ConversionConfiguration } from '@graphics-workbench/core/conversion';

export const defaultRasterMaxInputPixels = 268_402_689;

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

export function readConfiguredConversionConfiguration(): ConversionConfiguration {
  return {
    maxInputPixels: defaultRasterMaxInputPixels,
    maxAnimationPixels: defaultRasterMaxInputPixels,
    platform: process.platform,
    svgToPdf: {
      engine: 'rsvg-convert',
      rsvgConvertPath: requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH', 'rsvg-convert'),
      chromePath: '',
    },
    drawioPath: requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io'),
    avifEffort: 4,
    webpEffort: 4,
  };
}

/** Builds a minimal {@link ConversionConfiguration} that does not probe external tools. */
export function testConversionConfiguration(overrides: Partial<ConversionConfiguration> = {}): ConversionConfiguration {
  return {
    maxInputPixels: defaultRasterMaxInputPixels,
    maxAnimationPixels: defaultRasterMaxInputPixels,
    platform: process.platform,
    svgToPdf: {
      engine: 'rsvg-convert',
      rsvgConvertPath: 'rsvg-convert',
      chromePath: 'chrome',
    },
    drawioPath: 'drawio',
    avifEffort: 4,
    webpEffort: 4,
    ...overrides,
  };
}
