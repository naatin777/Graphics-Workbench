import type { Buffer as MupdfBuffer } from 'mupdf';

/** mupdf's raw object type cannot be resolved by oxlint's single-file type-aware lint; these interfaces describe only the members the extension uses. */
export interface MupdfPdfObject {
  isArray(): boolean;
  isNumber(): boolean;
  length: number;
  asNumber(): number;
  // oxlint-disable-next-line typescript/no-restricted-types -- mupdfネイティブバインディング: PDFオブジェクトのJS値は種類によって型が動的に決まる。
  asJS(): unknown;
  get(indexOrName: number | string): MupdfPdfObject;
  getInheritable(name: string): MupdfPdfObject;
  put(key: string | number, value: MupdfPdfObject | number[] | number): MupdfPdfObject;
}

/**
 * Memory guard for the content-detection probe: giant pages lower the
 * detection resolution instead of being rejected or scanned at full size.
 * It is not a processing limit.
 */
const MAX_CONTENT_RENDER_PIXELS = 50_000_000;

export interface MupdfPixmap {
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
  destroy(): void;
}

interface MupdfPdfDocumentReader {
  countPages(): number;
  loadPage(index: number): MupdfPdfPage;
  needsPassword(): boolean;
  authenticatePassword(password: string): number;
  saveToBuffer(options?: string): MupdfBuffer;
  destroy(): void;
}

export interface MupdfPdfDocumentInstance extends MupdfPdfDocumentReader {
  graftPage(toIndex: number, sourceDocument: MupdfPdfDocumentInstance, sourcePageIndex: number): void;
  rearrangePages(pages: number[]): void;
  addImage(image: MupdfImage): MupdfPdfObject;
  newDictionary(): MupdfPdfObject;
  newName(value: string): MupdfPdfObject;
  addStream(data: string | Uint8Array, obj: MupdfPdfObject | null): MupdfPdfObject;
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
  loadPage(index: number): MupdfPdfPage;
  needsPassword(): boolean;
  authenticatePassword(password: string): number;
  getMetaData(key: string): string | undefined;
}

let mupdfModule: MupdfModule | undefined;

/** Loads the MuPDF.js WASM module once. mupdf must be loaded dynamically because its ESM build uses top-level await, which cannot be `require()`d by the extension-host test runner. */
export async function loadMupdf(): Promise<MupdfModule> {
  if (mupdfModule === undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mupdf.jsのESMは型が未解決で、default exportをこの境界で確定する。
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

/** Returns whether the given 1-based page draws any visible (non-white) content. */
export async function hasPdfPageContent(bytes: Uint8Array, page: number): Promise<boolean> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  try {
    const pageObject = document.loadPage(page - 1);
    try {
      return findVisibleContentBounds(pageObject, mupdf) !== undefined;
    } finally {
      pageObject.destroy();
    }
  } finally {
    document.destroy();
  }
}

/**
 * Renders a PDF page to a PNG buffer. `page` is 1-based; the default scale
 * matches MuPDF's default 150 DPI (72 * 150 / 72 = 1.5x zoom on the 72pt page).
 * With `cropContent`, white margins are trimmed to the drawn content bounds
 * (a pdfcrop-like behavior implemented on top of mupdf.js).
 */
export async function renderPdfPageToPng(
  bytes: Uint8Array,
  page: number,
  options?: { dpi?: number; cropContent?: boolean },
): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  try {
    const pageObject = document.loadPage(page - 1);
    try {
      if (options?.cropContent === true) {
        const bounds = findVisibleContentBounds(pageObject, mupdf);
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
      pageObject.destroy();
    }
  } finally {
    document.destroy();
  }
}

/**
 * Returns the visible content bounds of a page in PDF coordinates, or
 * `undefined` for a page with no visible content.
 *
 * Semantics follow pdfcrop / Ghostscript's bbox device: the page is rendered
 * onto a white background and only pixels that are not pure white count as
 * content, so a full-page white rectangle does not make the whole page content.
 * `DisplayList.getBounds()` cannot be used for this: it returns the display
 * list's mediabox (`fz_bound_display_list` returns `list->mediabox`), i.e. the
 * page box, not the drawn content bounds.
 */
export function findVisibleContentBounds(page: MupdfPdfPage, mupdf: MupdfModule): MupdfRect | undefined {
  const mediabox = page.getBounds('MediaBox');
  const width = mediabox[2] - mediabox[0];
  const height = mediabox[3] - mediabox[1];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  // Cap the probe so giant pages reduce the detection resolution instead of
  // consuming unbounded memory (a memory guard, not a processing limit).
  const pixelCount = Math.ceil(width) * Math.ceil(height);
  const scale = pixelCount > MAX_CONTENT_RENDER_PIXELS ? Math.sqrt(MAX_CONTENT_RENDER_PIXELS / pixelCount) : 1;
  const probePixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
  try {
    const pixelBounds = findVisiblePixelBounds(probePixmap);
    if (pixelBounds === undefined) {
      return undefined;
    }
    const [minX, minY, maxX, maxY] = pixelBounds;
    const deviceRect: MupdfRect = [minX / scale, minY / scale, maxX / scale, maxY / scale];
    // Map device (pixel) coordinates back to PDF space via the inverse page
    // transform, so offset MediaBoxes and page rotation are handled instead of
    // assuming a (0,0) mediabox origin and an unrotated page.
    return mupdf.Rect.transform(deviceRect, mupdf.Matrix.invert(page.getTransform()));
  } finally {
    probePixmap.destroy();
  }
}

/**
 * Returns the bounds of the visible (non-pure-white) pixels in a DeviceRGB
 * pixmap without alpha, or `undefined` when every pixel is pure white.
 * The pixmap must match the 3-bytes-per-pixel DeviceRGB layout; a buffer whose
 * length contradicts that layout is an invariant violation and fails fast
 * instead of being reported as an empty page.
 */
export function findVisiblePixelBounds(pixmap: MupdfPixmap): [number, number, number, number] | undefined {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  const pixels = pixmap.getPixels();
  const expectedPixelBytes = width * height * 3;
  if (pixels.length !== expectedPixelBytes) {
    throw new Error(
      `Rendered PDF pixmap buffer length ${pixels.length} does not match the DeviceRGB layout (${expectedPixelBytes} bytes for ${width}x${height}).`,
    );
  }

  const bytes = new DataView(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      if (bytes.getUint8(index) !== 255 || bytes.getUint8(index + 1) !== 255 || bytes.getUint8(index + 2) !== 255) {
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
  return [minX, minY, maxX + 1, maxY + 1];
}

/** Renders a PDF page to an SVG string. `page` is 1-based. */
export async function renderPdfPageToSvg(bytes: Uint8Array, page: number): Promise<string> {
  const mupdf = await loadMupdf();
  const document = await openPdfDocument(bytes);
  const buffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buffer, 'svg', '');
  try {
    const pageObject = document.loadPage(page - 1);
    try {
      const device = writer.beginPage(pageObject.getBounds('CropBox'));
      try {
        pageObject.run(device, mupdf.Matrix.identity);
      } finally {
        device.close();
      }
      writer.endPage();
      writer.close();
      return buffer.asString();
    } finally {
      pageObject.destroy();
    }
  } finally {
    buffer.destroy();
    document.destroy();
  }
}

/** Serializes a mupdf buffer into a fresh Uint8Array. */
export function bufferToBytes(buffer: MupdfBuffer): Uint8Array {
  return Uint8Array.from(buffer.asUint8Array());
}

/** Saves a PDF document to bytes. The caller owns and must destroy the document. */
export function savePdfDocument(document: MupdfPdfDocumentInstance, options?: string): Uint8Array {
  const buffer = document.saveToBuffer(options);
  try {
    return bufferToBytes(buffer);
  } finally {
    buffer.destroy();
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
