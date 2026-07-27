import { createSimpleRasterExecutor, type RasterJob } from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';

export type ConvertToTiffJob = RasterJob;

export const executeTiffConversion = createSimpleRasterExecutor({
  operationName: 'convert-to-tiff',
  resultExtension: 'tiff',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).tiff().toFile(outputPath);
  },
});
