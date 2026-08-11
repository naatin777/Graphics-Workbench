import { readFile, rename, rm, writeFile } from 'node:fs/promises';

import { openPdfDocument, bufferToBytes, type MupdfPdfPage } from '@graphics-workbench/core/operations/pdf/mupdf.js';

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

export interface CropPdfFileWriter {
  writeFile: (filePath: string, data: Uint8Array) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  remove: (filePath: string) => Promise<void>;
}

const defaultWriter: CropPdfFileWriter = {
  writeFile,
  rename,
  remove: async (filePath) => {
    await rm(filePath, { force: true });
  },
};

/** Applies a configured crop in the isolated crop child process. */
export async function cropPdfFile(
  request: CropPdfFileRequest,
  writer: CropPdfFileWriter = defaultWriter,
): Promise<void> {
  const sourceBytes = await readFile(request.sourcePath);
  const document = await openPdfDocument(sourceBytes);
  try {
    const targetPageIndexes = targetToPageIndexes(request.target, document.countPages());

    // oxlint-disable-next-line no-unreachable-loop -- Every selected page must be updated.
    for (const pageIndex of targetPageIndexes) {
      const page = document.loadPage(pageIndex);
      try {
        setPageCropBox(page, request.cropBox);
      } finally {
        page.destroy();
      }
    }

    const saveBuffer = document.saveToBuffer();
    let outputBytes: Uint8Array;
    try {
      outputBytes = bufferToBytes(saveBuffer);
    } finally {
      saveBuffer.destroy();
    }
    const temporaryOutputPath = `${request.stagedOutputPath}.partial`;
    try {
      await writer.writeFile(temporaryOutputPath, outputBytes);
      await writer.rename(temporaryOutputPath, request.stagedOutputPath);
    } finally {
      await writer.remove(temporaryOutputPath).catch(() => {
        // The operation owner cleans the staging root after a failed child run.
      });
    }
  } finally {
    document.destroy();
  }
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

function setPageCropBox(page: MupdfPdfPage | undefined, cropBox: CropBox): void {
  if (!page) {
    throw new Error('Target page was not found.');
  }

  validateCropBox(cropBox, page);
  // ponytail: mupdf setPageBox() maps into its rotated page space (y-down), which
  // would flip the stored CropBox; write the raw box so the configured region is kept.
  page.getObject().put('CropBox', [cropBox.left, cropBox.bottom, cropBox.right, cropBox.top]);
}

function validateCropBox(cropBox: CropBox, page: MupdfPdfPage): void {
  const [mediaLeft, mediaBottom, mediaRight, mediaTop] = pageMediaBox(page);

  for (const [key, value] of Object.entries(cropBox)) {
    if (!Number.isFinite(value)) {
      throw new Error(`Crop box ${key} must be a finite number.`);
    }
  }

  if (cropBox.left >= cropBox.right || cropBox.bottom >= cropBox.top) {
    throw new Error('Crop box must have positive width and height.');
  }

  if (
    cropBox.left < mediaLeft ||
    cropBox.bottom < mediaBottom ||
    cropBox.right > mediaRight ||
    cropBox.top > mediaTop
  ) {
    throw new Error('Crop box must be inside the page media box.');
  }
}

function pageMediaBox(page: MupdfPdfPage): readonly [number, number, number, number] {
  const mediaBox = page.getObject().getInheritable('MediaBox');
  if (!mediaBox.isArray() || mediaBox.length !== 4) {
    return [0, 0, 612, 792];
  }

  return [
    mediaBox.get(0).asNumber(),
    mediaBox.get(1).asNumber(),
    mediaBox.get(2).asNumber(),
    mediaBox.get(3).asNumber(),
  ];
}
