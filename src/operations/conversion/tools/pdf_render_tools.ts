type RunPdfToPng = (sourcePath: string, outputPath: string, page: number, signal?: AbortSignal) => Promise<void>;

export type RunPdfToSvg = (sourcePath: string, outputPath: string, page: number, signal?: AbortSignal) => Promise<void>;

/**
 * Test-seam for PDF → PNG/SVG rendering. Production uses mupdf.js; these
 * callbacks let tests inject a stub or a fixed renderer.
 */
export interface PdfRenderBackend {
  runPdfToPng?: RunPdfToPng;
  runPdfToSvg?: RunPdfToSvg;
}
