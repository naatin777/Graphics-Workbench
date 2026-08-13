// Test helper that reproduces the small subset of pdf-lib's PDFDocument/PDFPage
// API the test suite uses, on top of mupdf. Kept intentionally minimal:
// pdf-lib was removed as a dependency, and tests only need to create PDFs with
// sized/rotated pages and boxes, draw rectangles, and read page count/size/
// boxes/rotation back.

import {
  getPdfPageGeometry,
  loadMupdf,
  openPdfDocument,
  savePdfDocument,
  type MupdfPdfDocumentInstance,
} from '@graphics-workbench/core/pdf';

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfSize {
  width: number;
  height: number;
}

export interface PdfRotation {
  angle: number;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** Mirrors pdf-lib's `degrees()`. */
export function degrees(angle: number): PdfRotation {
  return { angle };
}

/** Mirrors pdf-lib's `rgb()`: channel values are in the 0..1 range. */
export function rgb(red: number, green: number, blue: number): RgbColor {
  return { red, green, blue };
}

interface PageSpec {
  kind: 'build';
  width: number;
  height: number;
  mediaBox?: [number, number, number, number];
  cropBox?: [number, number, number, number];
  rotation?: number;
  contentOps: string[];
}

interface ReadPageData {
  kind: 'read';
  mediaBox: PdfBox;
  cropBox: PdfBox;
  rotation: number;
}

type PageState = PageSpec | ReadPageData;

export class PDFDocument {
  private readonly buildPages: PageSpec[] = [];
  private readonly readPages: ReadPageData[] | undefined;

  private constructor(readPages?: ReadPageData[]) {
    this.readPages = readPages;
  }

  /** Creates a blank document for building fixture PDFs. */
  static async create(): Promise<PDFDocument> {
    return new PDFDocument();
  }

  /** Loads a PDF and extracts every page's geometry, releasing the mupdf document. */
  static async load(bytes: Uint8Array): Promise<PDFDocument> {
    const document = await openPdfDocument(bytes);
    try {
      const pages: ReadPageData[] = [];
      for (let index = 0; index < document.countPages(); index += 1) {
        pages.push(readPageGeometry(document, index + 1));
      }
      return new PDFDocument(pages);
    } finally {
      document.destroy();
    }
  }

  /** Adds a page of the given size to the fixture being built. */
  addPage(size: [number, number]): PDFPage {
    const spec: PageSpec = { kind: 'build', width: size[0], height: size[1], contentOps: [] };
    this.buildPages.push(spec);
    return new PDFPage(spec);
  }

  getPageCount(): number {
    return (this.readPages ?? this.buildPages).length;
  }

  getPages(): PDFPage[] {
    const states: PageState[] = this.readPages ?? this.buildPages;
    return states.map((state) => new PDFPage(state));
  }

  getPage(index: number): PDFPage {
    const page = this.getPages()[index];
    if (page === undefined) {
      throw new Error(`Page index ${index} is out of bounds.`);
    }
    return page;
  }

  /** Serializes the built fixture to bytes. */
  async save(): Promise<Uint8Array> {
    const mupdf = await loadMupdf();
    const document = new mupdf.PDFDocument();
    for (const spec of this.buildPages) {
      const page = document.newDictionary();
      page.put('Type', document.newName('Page'));
      page.put('MediaBox', spec.mediaBox ?? [0, 0, spec.width, spec.height]);
      if (spec.cropBox !== undefined) {
        page.put('CropBox', spec.cropBox);
      }
      if (spec.rotation !== undefined) {
        page.put('Rotate', spec.rotation);
      }
      const content = document.addStream(spec.contentOps.join(' '), null);
      page.put('Contents', content);
      document.insertPage(document.countPages(), document.addObject(page));
    }
    try {
      return savePdfDocument(document);
    } finally {
      document.destroy();
    }
  }
}

export class PDFPage {
  private readonly state: PageState;

  constructor(state: PageState) {
    this.state = state;
  }

  setRotation(rotation: PdfRotation): void {
    this.requireSpec().rotation = rotation.angle;
  }

  setMediaBox(x: number, y: number, width: number, height: number): void {
    this.requireSpec().mediaBox = [x, y, x + width, y + height];
  }

  setCropBox(x: number, y: number, width: number, height: number): void {
    this.requireSpec().cropBox = [x, y, x + width, y + height];
  }

  drawRectangle(options: { x: number; y: number; width: number; height: number; color?: RgbColor }): void {
    const color = options.color ?? { red: 0, green: 0, blue: 0 };
    this.requireSpec().contentOps.push(
      `q ${color.red} ${color.green} ${color.blue} rg ${options.x} ${options.y} ${options.width} ${options.height} re f Q`,
    );
  }

  // ponytail: drawText content is never verified by the tests (only page counts
  // and byte equality), so no text is drawn. If a test later needs text
  // extraction, embed a standard font via mupdf.addSimpleFont.
  drawText(_text: string): void {
    return;
  }

  getSize(): PdfSize {
    const box = this.mediaBox();
    return { width: box.width, height: box.height };
  }

  getMediaBox(): PdfBox {
    return this.mediaBox();
  }

  getCropBox(): PdfBox {
    if (this.state.kind === 'read') {
      return this.state.cropBox;
    }
    return this.state.cropBox !== undefined ? boxFromArray(this.state.cropBox) : this.mediaBox();
  }

  getRotation(): PdfRotation {
    if (this.state.kind === 'read') {
      return { angle: this.state.rotation };
    }
    return { angle: this.state.rotation ?? 0 };
  }

  getWidth(): number {
    return this.mediaBox().width;
  }

  getHeight(): number {
    return this.mediaBox().height;
  }

  private requireSpec(): PageSpec {
    if (this.state.kind === 'read') {
      throw new Error('This operation is only available on pages being built.');
    }
    return this.state;
  }

  private mediaBox(): PdfBox {
    if (this.state.kind === 'read') {
      return this.state.mediaBox;
    }
    return this.state.mediaBox !== undefined
      ? boxFromArray(this.state.mediaBox)
      : { x: 0, y: 0, width: this.state.width, height: this.state.height };
  }
}

function readPageGeometry(document: MupdfPdfDocumentInstance, pageNumber: number): ReadPageData {
  const page = document.loadPage(pageNumber - 1);
  try {
    const geometry = getPdfPageGeometry(page, pageNumber);
    return {
      kind: 'read',
      mediaBox: geometry.mediaBox,
      cropBox: geometry.cropBox,
      rotation: geometry.rotation,
    };
  } finally {
    page.destroy();
  }
}

function boxFromArray(box: [number, number, number, number]): PdfBox {
  return { x: box[0], y: box[1], width: box[2] - box[0], height: box[3] - box[1] };
}
