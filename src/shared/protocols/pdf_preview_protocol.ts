import { hasExactKeys, isRecord } from './protocol_utils.js';

export interface PdfPreviewSettings {
  maxCanvasPixels: number;
  maxDevicePixelRatio: number;
}

export function isPdfPreviewSettings(value: unknown): value is PdfPreviewSettings {
  const maxCanvasPixels = isRecord(value) ? value.maxCanvasPixels : undefined;
  const maxDevicePixelRatio = isRecord(value) ? value.maxDevicePixelRatio : undefined;
  return (
    isRecord(value) &&
    hasExactKeys(value, ['maxCanvasPixels', 'maxDevicePixelRatio']) &&
    typeof maxCanvasPixels === 'number' &&
    Number.isInteger(maxCanvasPixels) &&
    maxCanvasPixels >= 1_000_000 &&
    typeof maxDevicePixelRatio === 'number' &&
    Number.isFinite(maxDevicePixelRatio) &&
    maxDevicePixelRatio >= 1 &&
    maxDevicePixelRatio <= 8
  );
}
