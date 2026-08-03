import type { PDFPage } from 'pdf-lib';

import type { PdfPageGeometry, PdfPageRotation, PdfRectangle } from '../../application/protocols/crop_pdf_protocol.js';

export function getPdfPageGeometry(page: PDFPage, pageNumber: number): PdfPageGeometry {
  return {
    page: pageNumber,
    mediaBox: rectangleFrom(page.getMediaBox()),
    cropBox: rectangleFrom(page.getCropBox()),
    rotation: normalizePageRotation(page.getRotation().angle),
  };
}

function rectangleFrom(rectangle: { x: number; y: number; width: number; height: number }): PdfRectangle {
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height,
  };
}

function normalizePageRotation(angle: number): PdfPageRotation {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }

  return 0;
}
