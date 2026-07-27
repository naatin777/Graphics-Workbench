import { createSimpleRasterExecutor, type RasterJob } from './raster_conversion.js';
import { openRasterInput } from './raster_input.js';

export type ConvertToPngJob = RasterJob;

export const executePngConversion = createSimpleRasterExecutor({
  operationName: 'convert-to-png',
  resultExtension: 'png',
  encoder: async (sourcePath, outputPath, maxInputPixels, page) => {
    await openRasterInput(sourcePath, maxInputPixels, page).png().toFile(outputPath);
  },
});
