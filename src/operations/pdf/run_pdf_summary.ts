import { readFile } from 'node:fs/promises';

import { PDFDocument } from 'pdf-lib';

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
  const pdf = await PDFDocument.load(bytes);
  signal.throwIfAborted();
  const pageCount = pdf.getPageCount();
  signal.throwIfAborted();

  return { pageCount };
}
