export { assertRenderedPdfPagesSimilar, assertPdfMatches, type PdfPageVisualComparison } from './assertions/pdf.js';
export { assertRasterMatches } from './assertions/raster.js';
export {
  calculateRgbaDifference,
  readNormalizedRgbaPixels,
  readRgbaPixels,
  type DecodedImage,
  type RasterComparisonOptions,
  type RgbaDifference,
} from './assertions/raster_content.js';
export { assertSvgStructureMatches } from './assertions/svg.js';
export {
  PDFDocument,
  PDFPage,
  degrees,
  rgb,
  type PdfBox,
  type PdfRotation,
  type PdfSize,
  type RgbColor,
} from './document.js';
export { listFixtureFilePaths, listFixtureFilePathsSync } from './fixture_files.js';
export { buildPdfFixture, type PdfFixturePage } from './fixtures/pdf.js';
export {
  invalidPreflightInputDirectory,
  listInputFixturePaths,
  listInputFixturePathsSync,
  operationDrawioInputDirectory,
  operationPdfInputDirectory,
  operationPngInputPath,
  operationSvgInputPath,
  repositoryRootDirectory,
  testInputDirectory,
  testOutputDirectory,
} from './fixtures/paths.js';
export { RecordingOutputChannel } from './output_channel.js';
export { findRepositoryRoot } from './repository.js';
export { requireValue } from './required.js';
export { createTestRuntime, type CreateTestRuntimeOptions, type TestRuntime } from './runtime.js';
export { defaultRasterMaxInputPixels, readConfiguredConversionTools, type ConfiguredConversionTools } from './tools.js';
export { copyInputToWorkspace, withTestWorkspace } from './workspace.js';
