import { readFile, writeFile } from 'node:fs/promises';

import { renderPdfPageToPng } from '../../pdf/mupdf.js';

type RunPdfToPng = (
  sourcePath: string,
  outputPath: string,
  page: number,
  signal: AbortSignal,
  cropContent?: boolean,
) => Promise<void>;

export type RunPdfToSvg = (sourcePath: string, outputPath: string, page: number, signal: AbortSignal) => Promise<void>;

/** PDF → PNG rendering boundary. Production uses mupdf.js; tests inject a stub. */
export interface PdfRenderBackend {
  runPdfToPng: RunPdfToPng;
}

/** Creates the production PDF → PNG backend backed by mupdf.js. */
export function createPdfRenderBackend(): PdfRenderBackend {
  return {
    runPdfToPng: async (sourcePath, outputPath, page, signal, cropContent) => {
      signal.throwIfAborted();
      const pdfBytes = await readFile(sourcePath);
      signal.throwIfAborted();
      const png = await renderPdfPageToPng(pdfBytes, page, {
        ...(cropContent !== undefined && { cropContent }),
      });
      signal.throwIfAborted();
      await writeFile(outputPath, png);
    },
  };
}
