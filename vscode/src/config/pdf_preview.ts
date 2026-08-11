import type { Configuration } from '../generated/extension_manifest.js';

import type { PdfPreviewSettings } from '../shared/protocols/pdf_preview_protocol.js';

export function readPdfPreviewSettings(configuration: Configuration): PdfPreviewSettings {
  return {
    maxCanvasPixels: configuration.preview.maxCanvasPixels(),
    maxDevicePixelRatio: configuration.preview.maxDevicePixelRatio(),
  };
}
