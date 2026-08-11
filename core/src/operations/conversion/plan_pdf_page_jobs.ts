import { assertPageTemplateForSplitOutput, formatOutputPage } from '../../config/output/page_template.js';
import { resolveOutputPath } from '../../config/output/resolve_output_path.js';

/** The source file location used as the base for planning per-page inputs. */
export interface PdfPageSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
}

export interface PdfPageInput {
  sourcePath: string;
  workspacePath: string;
  outputPath: string;
  page: number;
}

/**
 * Pure PDF page planner shared by VS Code commands and non-VS Code frontends.
 * Selected page numbers remain 1-based and duplicate selections are collapsed
 * while preserving the user's first-seen order.
 */
export function planPdfPageJobs(
  source: PdfPageSource,
  pageCount: number,
  outputTemplate: string,
  allowedExtensions: readonly string[],
  selectedPages?: readonly number[],
): PdfPageInput[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new Error(`PDF has no pages: ${source.sourcePath}`);
  }

  const pages = normalizeSelectedPages(selectedPages ?? allPages(pageCount), pageCount);
  assertPageTemplateForSplitOutput(outputTemplate, pageCount);

  return pages.map((page) => ({
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
  }));
}

function allPages(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_value, index) => index + 1);
}

function normalizeSelectedPages(selectedPages: readonly number[], pageCount: number): number[] {
  if (selectedPages.length === 0) {
    throw new Error('At least one PDF page must be selected.');
  }

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const page of selectedPages) {
    if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`PDF page is outside the range 1-${pageCount}: ${page}`);
    }
    if (!seen.has(page)) {
      seen.add(page);
      pages.push(page);
    }
  }
  return pages;
}
