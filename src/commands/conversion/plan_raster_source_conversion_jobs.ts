import {
  isEditableDrawioImagePath,
  isRasterImagePath,
  logicalSourcePathForOutputTemplate,
} from '../../shared/source_format.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import type { RasterJob } from '../../operations/conversion/raster_conversion.js';
import { planRasterFrameJobs } from './plan_raster_frame_jobs.js';

export async function planRasterSourceConversionJobs(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
}): Promise<RasterJob[]> {
  const page = isEditableDrawioImagePath(options.sourcePath) ? '1' : undefined;
  if (isRasterImagePath(options.sourcePath)) {
    return planRasterFrameJobs(options);
  }

  const outputPath = resolveOutputPath(
    options.outputTemplate,
    {
      sourcePath: logicalSourcePathForOutputTemplate(options.sourcePath),
      workspacePath: options.workspacePath,
      workspaceName: options.workspaceName,
      ...(page !== undefined && { page }),
    },
    { allowedExtensions: options.allowedExtensions },
  );

  return [
    {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      outputPath,
      ...(page !== undefined && { page: Number(page) }),
    },
  ];
}
