import { readFile, writeFile } from 'node:fs/promises';

import { PDFDocument, type PDFPage } from 'pdf-lib';

export interface CropBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export type CropTarget =
  | { type: 'all' }
  | {
      type: 'selected';
      pages: number[];
    };

export interface CropPdfFileRequest {
  sourcePath: string;
  stagedOutputPath: string;
  cropBox: CropBox;
  target: CropTarget;
}

/** Applies a configured crop in the isolated crop child process. */
export async function cropPdfFile(request: CropPdfFileRequest): Promise<void> {
  const sourceBytes = await readFile(request.sourcePath);
  const document = await PDFDocument.load(sourceBytes);
  const pages = document.getPages();
  const targetPageIndexes = targetToPageIndexes(request.target, pages.length);

  for (const pageIndex of targetPageIndexes) {
    setPageCropBox(pages[pageIndex], request.cropBox);
  }

  const outputBytes = await document.save();
  await writeFile(request.stagedOutputPath, outputBytes);
}

function targetToPageIndexes(target: CropTarget, pageCount: number): number[] {
  if (pageCount === 0) {
    throw new Error('PDF has no pages.');
  }

  if (target.type === 'all') {
    return Array.from({ length: pageCount }, (_value, index) => index);
  }

  if (target.pages.length === 0) {
    throw new Error('At least one page must be selected.');
  }

  const indexes = target.pages.map((page) => {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`Selected page is out of range: ${page}`);
    }

    return page - 1;
  });

  return [...new Set(indexes)];
}

function setPageCropBox(page: PDFPage | undefined, cropBox: CropBox): void {
  if (!page) {
    throw new Error('Target page was not found.');
  }

  validateCropBox(cropBox, page);
  const width = cropBox.right - cropBox.left;
  const height = cropBox.top - cropBox.bottom;
  page.setMediaBox(cropBox.left, cropBox.bottom, width, height);
  page.setCropBox(cropBox.left, cropBox.bottom, width, height);
}

function validateCropBox(cropBox: CropBox, page: PDFPage): void {
  const mediaBox = page.getMediaBox();
  const mediaRight = mediaBox.x + mediaBox.width;
  const mediaTop = mediaBox.y + mediaBox.height;

  for (const [key, value] of Object.entries(cropBox)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Crop box ${key} must be a finite number.`);
    }
  }

  if (cropBox.left >= cropBox.right || cropBox.bottom >= cropBox.top) {
    throw new Error('Crop box must have positive width and height.');
  }

  if (
    cropBox.left < mediaBox.x ||
    cropBox.bottom < mediaBox.y ||
    cropBox.right > mediaRight ||
    cropBox.top > mediaTop
  ) {
    throw new Error('Crop box must be inside the page media box.');
  }
}
