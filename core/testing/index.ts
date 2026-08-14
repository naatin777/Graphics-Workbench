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
  createPdfTestData,
  fillRectangle,
  readPdfPages,
  type PdfTestDataOptions,
  type PdfTestDataPage,
  type PdfTestDataPageGeometry,
} from './testdata/pdf_testdata.js';
export { listTestDataFilePaths, listTestDataFilePathsSync } from './testdata_files.js';
export {
  invalidPreflightInputDirectory,
  listInputTestDataPaths,
  listInputTestDataPathsSync,
  operationDrawioInputDirectory,
  operationPdfInputDirectory,
  operationPngInputPath,
  operationSvgInputPath,
  repositoryRootDirectory,
  testInputDirectory,
  testOutputDirectory,
} from './testdata/path_definitions.js';
export { RecordingOutputChannel } from './output_channel.js';
export { findRepositoryRoot } from './repository.js';
export { requireValue } from './required.js';
export { createTestRuntime, type CreateTestRuntimeOptions, type TestRuntime } from './runtime.js';
export {
  defaultRasterMaxInputPixels,
  readConfiguredConversionTools,
  requireConfiguredTool,
  type ConfiguredConversionTools,
} from './tools.js';
export { copyInputToWorkspace, withTestWorkspace } from './workspace.js';
