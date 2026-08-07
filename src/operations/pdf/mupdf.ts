import type { Buffer as MupdfBuffer } from 'mupdf';

/** mupdf's raw object type cannot be resolved by oxlint's single-file type-aware lint; these interfaces describe only the members the extension uses. */
export interface MupdfPdfObject {
  isArray(): boolean;
  isNumber(): boolean;
  length: number;
  asNumber(): number;
  asJS(): unknown;
  get(indexOrName: number | string): MupdfPdfObject;
  getInheritable(name: string): MupdfPdfObject;
  put(key: string | number, value: unknown): unknown;
}

interface MupdfPixmap {
  getWidth(): number;
  getHeight(): number;
  getPixels(): Uint8ClampedArray;
  asPNG(): Uint8Array;
  destroy(): void;
}

interface MupdfColorSpace {
  destroy(): void;
}

export interface MupdfPdfPage {
  getObject(): MupdfPdfObject;
  getBounds(boxName: 'MediaBox' | 'CropBox' | 'TrimBox'): MupdfRect;
  getTransform(): MupdfMatrix;
  setPageBox(boxName: 'MediaBox' | 'CropBox' | 'TrimBox', rect: MupdfRect): void;
  toPixmap(matrix: MupdfMatrix, colorspace: MupdfColorSpace, alpha: boolean): MupdfPixmap;
  run(device: MupdfDevice, matrix: MupdfMatrix): void;
}

interface MupdfPdfDocumentReader {
  countPages(): number;
  loadPage(index: number): MupdfPdfPage;
  needsPassword(): boolean;
  authenticatePassword(password: string): number;
  saveToBuffer(options?: string | Record<string, unknown>): MupdfBuffer;
  destroy(): void;
}

export interface MupdfPdfDocumentInstance extends MupdfPdfDocumentReader {
  graftPage(toIndex: number, sourceDocument: MupdfPdfDocumentInstance, sourcePageIndex: number): void;
  rearrangePages(pages: number[]): void;
  addImage(image: unknown): MupdfPdfObject;
  newDictionary(): MupdfPdfObject;
  newName(value: string): MupdfPdfObject;
  addStream(data: string | Uint8Array, obj: unknown): MupdfPdfObject;
  insertPage(atIndex: number, obj: MupdfPdfObject): void;
  addObject(obj: MupdfPdfObject): MupdfPdfObject;
}

export interface MupdfModule {
  PDFDocument: new () => MupdfPdfDocumentInstance;
  Image: new (data: Uint8Array) => MupdfImage;
  Document: {
    openDocument(bytes: Uint8Array): MupdfDocument;
  };
  Matrix: {
    scale(sx: number, sy: number): MupdfMatrix;
    invert(matrix: MupdfMatrix): MupdfMatrix;
    identity: MupdfMatrix;
  };
  ColorSpace: {
    DeviceRGB: MupdfColorSpace;
  };
  Rect: {
    transform(rect: MupdfRect, matrix: MupdfMatrix): MupdfRect;
  };
  Buffer: new () => MupdfBuffer;
  DocumentWriter: new (buffer: MupdfBuffer, format: string, options: string) => MupdfDocumentWriter;
}

interface MupdfDocumentWriter {
  beginPage(mediabox: MupdfRect): MupdfDevice;
  endPage(): void;
  close(): void;
}

interface MupdfDevice {
  close(): void;
}

type MupdfMatrix = [number, number, number, number, number, number];
type MupdfRect = [number, number, number, number];

interface MupdfImage {
  getWidth(): number;
  getHeight(): number;
  destroy(): void;
}

interface MupdfDocument {
  asPDF(): MupdfPdfDocumentInstance | null;
  destroy(): void;
  countPages(): number;
  loadPage(index: number): unknown;
  needsPassword(): boolean;
  authenticatePassword(password: string): number;
  getMetaData(key: string): string | undefined;
}

let mupdfModule: MupdfModule | undefined;

/** Loads the MuPDF.js WASM module once. mupdf must be loaded dynamically because its ESM build uses top-level await, which cannot be `require()`d by the extension-host test runner. */
export async function loadMupdf(): Promise<MupdfModule> {
  if (mupdfModule === undefined) {
    const imported = (await import('mupdf')) as { default: MupdfModule };
    mupdfModule = imported.default;
  }
  return mupdfModule;
}

/** Opens a PDF from bytes. Caller must `destroy()` the returned document. */
export async function openPdfDocument(bytes: Uint8Array): Promise<MupdfPdfDocumentInstance> {
  const mupdf = await loadMupdf();
  let document: MupdfDocument;
  try {
    document = mupdf.Document.openDocument(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse PDF: ${detail}`, { cause: error });
  }
  const pdf = document.asPDF();
  if (!pdf) {
    document.destroy();
    throw new Error('Failed to parse PDF: input is not a PDF document.');
  }
  return pdf;
}

/** Reads the page count of a PDF and releases the document. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const document = await openPdfDocument(bytes);
  try {
    return document.countPages();
  } finally {
    document.destroy();
  }
}

/** Returns whether the given 1-based page draws any non-white content. */
export async function hasPdfPageContent(bytes: Uint8Array, page: number): Promise<boolean> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  try {
    const pageObject = document.loadPage(page - 1);
    return findPageContentBounds(mupdf, pageObject) !== undefined;
  } finally {
    document.destroy();
  }
}

/**
 * Renders a PDF page to a PNG buffer. `page` is 1-based; the default scale
 * matches pdftocairo's 150 DPI (72 * 150 / 72 = 1.5x zoom on the 72pt page).
 * With `cropContent`, white margins are trimmed to the drawn content bounds
 * (a pdfcrop-like behavior implemented on top of mupdf.js).
 */
export async function renderPdfPageToPng(
  bytes: Uint8Array,
  page: number,
  options?: { dpi?: number; cropContent?: boolean | undefined },
): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  try {
    const pageObject = document.loadPage(page - 1);
    if (options?.cropContent === true) {
      const bounds = findPageContentBounds(mupdf, pageObject);
      if (bounds !== undefined) {
        pageObject.setPageBox('CropBox', bounds);
      }
    }
    const dpi = options?.dpi ?? 150;
    const scale = dpi / 72;
    const pixmap = pageObject.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    try {
      return Uint8Array.from(pixmap.asPNG());
    } finally {
      pixmap.destroy();
    }
  } finally {
    document.destroy();
  }
}

function findPageContentBounds(mupdf: MupdfModule, pageObject: MupdfPdfPage): MupdfRect | undefined {
  const probeDpi = 72;
  const probePixmap = pageObject.toPixmap(
    mupdf.Matrix.scale(probeDpi / 72, probeDpi / 72),
    mupdf.ColorSpace.DeviceRGB,
    false,
  );
  try {
    const bounds = findNonWhiteBounds(probePixmap);
    if (bounds === undefined) {
      return undefined;
    }
    const mediabox = pageObject.getBounds('MediaBox');
    const scale = 72 / probeDpi;
    return [bounds.x0 * scale, mediabox[3] - bounds.y1 * scale, bounds.x1 * scale, mediabox[3] - bounds.y0 * scale];
  } finally {
    probePixmap.destroy();
  }
}

function findNonWhiteBounds(pixmap: MupdfPixmap): { x0: number; y0: number; x1: number; y1: number } | undefined {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const pixels = pixmap.getPixels();
  const channels = Math.max(1, Math.floor(pixels.length / (width * height)));
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * channels;
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      if (red < 250 || green < 250 || blue < 250) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX === -1) {
    return undefined;
  }
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

/** Renders a PDF page to an SVG string. `page` is 1-based. */
export async function renderPdfPageToSvg(bytes: Uint8Array, page: number): Promise<string> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  const buffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buffer, 'svg', '');
  try {
    const pageObject = document.loadPage(page - 1);
    const device = writer.beginPage(pageObject.getBounds('CropBox'));
    pageObject.run(device, mupdf.Matrix.identity);
    writer.endPage();
    writer.close();
    return buffer.asString();
  } finally {
    buffer.destroy();
    document.destroy();
  }
}

/** Serializes a mupdf buffer into a fresh Uint8Array. */
export function bufferToBytes(buffer: MupdfBuffer): Uint8Array {
  return Uint8Array.from(buffer.asUint8Array());
}

/** Saves a PDF document to bytes and releases the document. */
export function savePdfDocument(
  document: MupdfPdfDocumentInstance,
  options?: string | Record<string, unknown>,
): Uint8Array {
  try {
    const buffer = document.saveToBuffer(options);
    try {
      return bufferToBytes(buffer);
    } finally {
      buffer.destroy();
    }
  } finally {
    document.destroy();
  }
}

/** Normalizes a page rotation angle to 0/90/180/270. */
export function normalizeRotation(angle: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.trunc(angle) % 360) + 360) % 360;
  switch (normalized) {
    case 0: {
      return 0;
    }
    case 90: {
      return 90;
    }
    case 180: {
      return 180;
    }
    case 270: {
      return 270;
    }
    default: {
      throw new Error(`Invalid page rotation: ${angle}`);
    }
  }
}
