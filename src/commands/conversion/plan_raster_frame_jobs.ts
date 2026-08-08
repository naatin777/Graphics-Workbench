import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { assertAnimationPixelLimit } from '../../config/raster.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import { closeRasterPipeline, openRasterInput } from '../../operations/conversion/raster_input.js';
import type { RasterJob } from '../../operations/conversion/raster_conversion.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

export interface RasterFramePlanOptions {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  frameMode?: 'first' | 'all';
  maxAnimationPixels?: number;
}

export interface RasterFrameAnalysis {
  pages: number;
  width: number;
  pageHeight: number;
}

/** Pure: 既知のframe metadataからjobを生成する。ファイル読み込みを伴わない。 */
export function planRasterFrameJobsFromMetadata(
  options: RasterFramePlanOptions,
  analysis: RasterFrameAnalysis,
): RasterJob[] {
  const { pages, width, pageHeight } = analysis;

  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error(`Could not determine image frame count: ${options.sourcePath}`);
  }

  const frameMode = options.frameMode ?? 'first';
  if (frameMode === 'all' && pages > 1 && options.maxAnimationPixels !== undefined) {
    assertAnimationPixelLimit(width, pageHeight, pages, options.maxAnimationPixels, options.sourcePath);
  }
  const outputPages = frameMode === 'all' ? pages : 1;
  assertPageTemplateForSplitOutput(options.outputTemplate, outputPages);

  return Array.from({ length: outputPages }, (_value, index) => {
    const page = index + 1;
    return {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      outputPath: resolveOutputPath(
        options.outputTemplate,
        {
          sourcePath: options.sourcePath,
          workspacePath: options.workspacePath,
          workspaceName: options.workspaceName,
          page: formatOutputPage(page, outputPages),
        },
        { allowedExtensions: options.allowedExtensions },
      ),
      page,
    };
  });
}

export async function planRasterFrameJobs(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
  maxAnimationPixels?: number;
  frameMode?: 'first' | 'all';
}): Promise<RasterJob[]> {
  await assertExistingPathInWorkspace(options.sourcePath, options.workspacePath);
  const image = openRasterInput(options.sourcePath, options.maxInputPixels);
  let pages: number;
  let width = 0;
  let pageHeight = 0;

  try {
    const metadata = await image.metadata();
    pages = metadata.pages ?? 1;
    ({ width } = metadata);
    pageHeight = metadata.pageHeight ?? metadata.height;
  } finally {
    await closeRasterPipeline(image);
  }

  const planOptions: RasterFramePlanOptions = {
    sourcePath: options.sourcePath,
    workspacePath: options.workspacePath,
    workspaceName: options.workspaceName,
    outputTemplate: options.outputTemplate,
    allowedExtensions: options.allowedExtensions,
  };
  if (options.frameMode !== undefined) {
    planOptions.frameMode = options.frameMode;
  }
  if (options.maxAnimationPixels !== undefined) {
    planOptions.maxAnimationPixels = options.maxAnimationPixels;
  }

  return planRasterFrameJobsFromMetadata(planOptions, { pages, width, pageHeight });
}
