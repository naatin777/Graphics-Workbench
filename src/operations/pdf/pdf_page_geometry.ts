import type { MupdfPdfObject, MupdfPdfPage } from './mupdf.js';

import type { PdfPageGeometry, PdfPageRotation, PdfRectangle } from '../../shared/protocols/crop_pdf_protocol.js';

export function getPdfPageGeometry(page: MupdfPdfPage, pageNumber: number): PdfPageGeometry {
  return {
    page: pageNumber,
    mediaBox: boxRectangle(page, 'MediaBox'),
    cropBox: boxRectangle(page, 'CropBox'),
    rotation: normalizePageRotation(pageRotation(page)),
  };
}

function boxRectangle(page: MupdfPdfPage, boxName: 'MediaBox' | 'CropBox'): PdfRectangle {
  const [x1, y1, x2, y2] = pageBox(page, boxName);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function pageBox(page: MupdfPdfPage, boxName: 'MediaBox' | 'CropBox'): readonly [number, number, number, number] {
  const box = boxArray(page, boxName);
  if (box) {
    return box;
  }

  // ponytail: mupdf getBounds() returns the rotated page-space box; read the raw
  // stored box so the DTO keeps the same absolute PDF coordinates as before.
  return boxArray(page, boxName === 'MediaBox' ? 'CropBox' : 'MediaBox') ?? [0, 0, 612, 792];
}

function boxArray(
  page: MupdfPdfPage,
  boxName: 'MediaBox' | 'CropBox',
): readonly [number, number, number, number] | null {
  const box = page.getObject().getInheritable(boxName);
  if (!box.isArray() || box.length !== 4) {
    return null;
  }

  return boxNumbers(box);
}

function boxNumbers(box: MupdfPdfObject): readonly [number, number, number, number] {
  return [box.get(0).asNumber(), box.get(1).asNumber(), box.get(2).asNumber(), box.get(3).asNumber()];
}

function pageRotation(page: MupdfPdfPage): number {
  const rotate = page.getObject().getInheritable('Rotate');
  return rotate.isNumber() ? rotate.asNumber() : 0;
}

function normalizePageRotation(angle: number): PdfPageRotation {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }

  return 0;
}
