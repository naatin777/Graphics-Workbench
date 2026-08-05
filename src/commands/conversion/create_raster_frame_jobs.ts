import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { assertAnimationPixelLimit } from '../../config/raster_limits.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';
import {
  destroyRasterInput,
  openRasterInput,
  type RasterAnimationMetadata,
} from '../../operations/conversion/raster_input.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';

export interface RasterFrameJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
  animation?: RasterAnimationMetadata;
}

export { readRasterAnimationMetadata } from '../../operations/conversion/raster_input.js';

export interface RasterFrameJobSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  frameMode?: 'first' | 'all' | undefined;
  maxAnimationPixels?: number | undefined;
  createJob: (job: RasterFrameJob) => RasterFrameJob;
}

export interface RasterFrameAnalysis {
  pages: number;
  width: number;
  pageHeight: number;
}

/** Pure: 既知のframe metadataからjobを生成する。ファイル読み込みを伴わない。 */
export function createRasterFrameJobsFromMetadata(
  options: RasterFrameJobSource,
  analysis: RasterFrameAnalysis,
): RasterFrameJob[] {
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
    return options.createJob({
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
    });
  });
}

export async function createRasterFrameJobs(options: {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  outputTemplate: string;
  allowedExtensions: readonly string[];
  maxInputPixels: number;
  maxAnimationPixels?: number;
  frameMode?: 'first' | 'all';
  createJob: (job: RasterFrameJob) => RasterFrameJob;
}): Promise<RasterFrameJob[]> {
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
    await destroyRasterInput(image);
  }

  return createRasterFrameJobsFromMetadata(
    {
      sourcePath: options.sourcePath,
      workspacePath: options.workspacePath,
      workspaceName: options.workspaceName,
      outputTemplate: options.outputTemplate,
      allowedExtensions: options.allowedExtensions,
      frameMode: options.frameMode,
      maxAnimationPixels: options.maxAnimationPixels,
      createJob: options.createJob,
    },
    { pages, width, pageHeight },
  );
}
