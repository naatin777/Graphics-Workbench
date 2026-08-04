import type { Configuration } from '../generated/extension_manifest.js';

export interface PdfPreviewSettings {
  maxCanvasPixels: number;
  maxDevicePixelRatio: number;
}

export function readPdfPreviewSettings(configuration: Configuration): PdfPreviewSettings {
  return {
    maxCanvasPixels: configuration.preview.maxCanvasPixels(),
    maxDevicePixelRatio: configuration.preview.maxDevicePixelRatio(),
  };
}
