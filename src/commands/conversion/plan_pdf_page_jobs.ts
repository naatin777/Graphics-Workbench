import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';

/** The source file location used as the base for planning per-page PDF jobs. */
export interface PdfPageSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
}

export interface PdfPageJob {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  page: number;
}

/** Pure: PDFの読み込み結果（page count）だけから、pageごとのjobを生成する。 */
export function planPdfPageJobs(
  source: PdfPageSource,
  pageCount: number,
  outputTemplate: string,
  allowedExtensions: readonly string[],
): PdfPageJob[] {
  if (pageCount === 0) {
    throw new Error(`PDF has no pages: ${source.sourcePath}`);
  }

  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  return Array.from({ length: pageCount }, (_value, index) => {
    const page = index + 1;
    return {
      sourcePath: source.sourcePath,
      workspacePath: source.workspacePath,
      outputPath: resolveOutputPath(
        outputTemplate,
        {
          sourcePath: source.sourcePath,
          workspacePath: source.workspacePath,
          workspaceName: source.workspaceName,
          page: formatOutputPage(page, pageCount),
        },
        { allowedExtensions },
      ),
      page,
    };
  });
}
