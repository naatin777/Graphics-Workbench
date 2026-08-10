export type RunPdfToPng = (
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
