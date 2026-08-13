import type { CropBox, CropTarget } from '@graphics-workbench/vscode-protocol/crop-pdf-protocol';

import type { CropPdfLabels } from './labels';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseCropBox(
  value: { left: string; bottom: string; right: string; top: string },
  labels: CropPdfLabels,
): Parsed<CropBox> {
  for (const [key, stringValue] of Object.entries(value)) {
    if (stringValue.trim().length === 0) {
      return { ok: false, message: labels.validation.cropBoxNumber.replace('{0}', key) };
    }
  }

  const cropBox = {
    left: Number(value.left),
    bottom: Number(value.bottom),
    right: Number(value.right),
    top: Number(value.top),
  };

  for (const [key, numberValue] of Object.entries(cropBox)) {
    if (!Number.isFinite(numberValue)) {
      return { ok: false, message: labels.validation.cropBoxNumber.replace('{0}', key) };
    }
  }

  if (cropBox.left >= cropBox.right || cropBox.bottom >= cropBox.top) {
    return { ok: false, message: labels.validation.cropBoxSize };
  }

  return { ok: true, value: cropBox };
}

export function parseTarget(
  targetType: 'all' | 'selected',
  selectedPages: string,
  pageCount: number,
  labels: CropPdfLabels,
): Parsed<CropTarget> {
  if (targetType === 'all') {
    return { ok: true, value: { type: 'all' } };
  }

  const pageValues = selectedPages
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (pageValues.length === 0) {
    return { ok: false, message: labels.validation.pagesRequired };
  }

  const pages = pageValues.map(Number);

  for (let index = 0; index < pages.length; index += 1) {
    if (!Number.isInteger(pages[index])) {
      return {
        ok: false,
        message: labels.validation.pageWholeNumber.replace('{0}', pageValues[index] ?? ''),
      };
    }
  }

  for (const page of pages) {
    if (page < 1 || page > pageCount) {
      return { ok: false, message: labels.validation.pageOutOfRange.replace('{0}', page.toString()) };
    }
  }

  return { ok: true, value: { type: 'selected', pages: [...new Set(pages)] } };
}
