import { readFile } from 'node:fs/promises';

import { countPdfPages } from '@graphics-workbench/core/operations/pdf/mupdf.js';

export interface PdfSummary {
  pageCount: number;
}

/**
 * Reads the PDF page count with cancellation checks so large loads stay
 * cancellable within a progress boundary. The internal implementation can later
 * move to a Worker or child process without changing callers.
 */
export async function inspectPdfSummary(filePath: string, signal: AbortSignal): Promise<PdfSummary> {
  signal.throwIfAborted();
  const bytes = await readFile(filePath);
  signal.throwIfAborted();
  const pageCount = await countPdfPages(bytes);
  signal.throwIfAborted();

  return { pageCount };
}
