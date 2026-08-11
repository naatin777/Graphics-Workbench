import { loadMupdf, savePdfDocument } from '@graphics-workbench/core/operations/pdf/mupdf.js';

export interface PdfFixturePage {
  width: number;
  height: number;
  contentOperations?: string;
}

export async function buildPdfFixture(pages: readonly PdfFixturePage[]): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = new mupdf.PDFDocument();

  try {
    for (const spec of pages) {
      const page = document.newDictionary();
      page.put('Type', document.newName('Page'));
      page.put('MediaBox', [0, 0, spec.width, spec.height]);
      page.put('Contents', document.addStream(spec.contentOperations ?? '', null));
      document.insertPage(document.countPages(), document.addObject(page));
    }
    return savePdfDocument(document);
  } finally {
    document.destroy();
  }
}
