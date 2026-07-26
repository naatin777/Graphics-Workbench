import { createSimpleRasterExecutor, type RasterJob } from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';

export type ConvertToJpegJob = RasterJob;

export const executeJpegConversion = createSimpleRasterExecutor({
  operationName: 'convert-to-jpeg',
  resultExtension: 'jpeg',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).jpeg().toFile(outputPath);
  },
});
