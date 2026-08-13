import type { Configuration } from '../generated/extension_manifest.js';

import type { PdfPreviewSettings } from '@graphics-workbench/vscode-protocol/pdf-preview-protocol';

export function readPdfPreviewSettings(configuration: Configuration): PdfPreviewSettings {
  return {
    maxCanvasPixels: configuration.preview.maxCanvasPixels(),
    maxDevicePixelRatio: configuration.preview.maxDevicePixelRatio(),
  };
}
