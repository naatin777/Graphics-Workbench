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
  destroy(): void;
}

export interface MupdfPdfPage {
  getObject(): MupdfPdfObject;
  getBounds(boxName: 'MediaBox' | 'CropBox' | 'TrimBox'): MupdfRect;
  getTransform(): MupdfMatrix;
  setPageBox(boxName: 'MediaBox' | 'CropBox' | 'TrimBox', rect: MupdfRect): void;
  toPixmap(matrix: MupdfMatrix, colorspace: unknown, alpha: boolean): MupdfPixmap;
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
  };
  ColorSpace: {
    DeviceRGB: unknown;
  };
  Rect: {
    transform(rect: MupdfRect, matrix: MupdfMatrix): MupdfRect;
  };
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
