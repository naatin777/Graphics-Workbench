import path from 'node:path';

import { isRasterImagePath, logicalSourcePathForOutputTemplate } from '../../application/policy/source_format.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { assertAnimationPixelLimit } from '../../config/raster_limits.js';
import { createRasterFrameJobs, readRasterAnimationMetadata, type RasterFrameJob } from './create_raster_frame_jobs.js';

export async function planAnimationRasterSourceJobs(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
  maxAnimationPixels: number;
  animatedInputExtension: string;
  outputMode?: 'auto' | 'preserve' | 'split';
}): Promise<RasterFrameJob[] | undefined> {
  if (!isRasterImagePath(options.sourcePath)) {
    return undefined;
  }

  const extension = path.extname(options.sourcePath).toLowerCase();
  const animation =
    extension === options.animatedInputExtension
      ? await readRasterAnimationMetadata(options.sourcePath, options.maxInputPixels)
      : undefined;

  if (animation !== undefined && options.outputMode !== 'split') {
    assertAnimationPixelLimit(
      animation.width ?? 0,
      animation.pageHeight,
      animation.pages,
      options.maxAnimationPixels,
      options.sourcePath,
    );
    return [
      {
        sourcePath: options.sourcePath,
        workspacePath: options.workspacePath,
        outputPath: resolveOutputPath(
          options.outputTemplate,
          {
            sourcePath: logicalSourcePathForOutputTemplate(options.sourcePath),
            workspacePath: options.workspacePath,
            workspaceName: options.workspaceName,
          },
          { allowedExtensions: options.allowedExtensions },
        ),
        animation,
      },
    ];
  }

  return createRasterFrameJobs({
    sourcePath: options.sourcePath,
    workspacePath: options.workspacePath,
    workspaceName: options.workspaceName,
    outputTemplate: options.outputTemplate,
    allowedExtensions: options.allowedExtensions,
    maxInputPixels: options.maxInputPixels,
    maxAnimationPixels: options.maxAnimationPixels,
    frameMode: options.outputMode === 'split' ? 'all' : 'first',
    createJob: (job) => job,
  });
}
