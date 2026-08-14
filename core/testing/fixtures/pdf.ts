import { getPdfPageGeometry, loadMupdf, openPdfDocument, savePdfDocument } from '@graphics-workbench/core/pdf';

export interface PdfFixturePage {
  mediaBox: [number, number, number, number];
  cropBox?: [number, number, number, number];
  rotation?: number;
  contents?: string[];
}

export interface PdfFixtureOptions {
  pages: PdfFixturePage[];
}

export interface PdfFixturePageGeometry {
  mediaBox: { x: number; y: number; width: number; height: number };
  cropBox: { x: number; y: number; width: number; height: number };
  rotation: number;
}

/**
 * Builds a synthetic PDF with the low-level MuPDF API. This is test input
 * generation only: it never shares code with the production rendering or
 * geometry pipeline, so a coordinate misunderstanding cannot cancel out
 * between generator and reader.
 */
export async function createPdfFixture(options: PdfFixtureOptions): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = new mupdf.PDFDocument();
  try {
    for (const spec of options.pages) {
      const page = document.newDictionary();
      page.put('Type', document.newName('Page'));
      page.put('MediaBox', spec.mediaBox);
      if (spec.cropBox !== undefined) {
        page.put('CropBox', spec.cropBox);
      }
      if (spec.rotation !== undefined) {
        page.put('Rotate', spec.rotation);
      }
      page.put('Contents', document.addStream(spec.contents?.join(' ') ?? '', null));
      document.insertPage(document.countPages(), document.addObject(page));
    }
    return savePdfDocument(document);
  } finally {
    document.destroy();
  }
}

/** Declarative content operator: paints a filled rectangle with an RGB color. */
export function fillRectangle(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: [number, number, number];
}): string {
  const [red, green, blue] = options.color ?? [0, 0, 0];
  return `q ${red} ${green} ${blue} rg ${options.x} ${options.y} ${options.width} ${options.height} re f Q`;
}

/**
 * Reads every page's geometry from a PDF through the production MuPDF
 * pipeline (`getPdfPageGeometry`). Used to verify operation outputs, never to
 * build fixtures.
 */
export async function readPdfPages(bytes: Uint8Array): Promise<PdfFixturePageGeometry[]> {
  const document = await openPdfDocument(bytes);
  try {
    const pages: PdfFixturePageGeometry[] = [];
    for (let index = 0; index < document.countPages(); index += 1) {
      pages.push(readPageGeometry(document, index + 1));
    }
    return pages;
  } finally {
    document.destroy();
  }
}

function readPageGeometry(
  document: Awaited<ReturnType<typeof openPdfDocument>>,
  pageNumber: number,
): PdfFixturePageGeometry {
  const page = document.loadPage(pageNumber - 1);
  try {
    const geometry = getPdfPageGeometry(page, pageNumber);
    return {
      mediaBox: geometry.mediaBox,
      cropBox: geometry.cropBox,
      rotation: geometry.rotation,
    };
  } finally {
    page.destroy();
  }
}
