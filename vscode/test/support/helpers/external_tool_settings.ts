import { getExtensionConfiguration } from '../../../src/config/extension_configuration.js';
import {
  createPdfRenderBackend,
  executeDrawio,
  type DrawioBackend,
  type PdfRenderBackend,
} from '@graphics-workbench/core/conversion';

export function readConfiguredConversionTools(): {
  pdfRenderTools: PdfRenderBackend;
  rsvgConvertPath: string;
  drawioTools: DrawioBackend;
} {
  const configuration = getExtensionConfiguration();

  return {
    pdfRenderTools: createPdfRenderBackend(),
    rsvgConvertPath: configuration.execPath.rsvgConvert(),
    drawioTools: { drawioPath: configuration.execPath.drawio(), runDrawio: executeDrawio },
  };
}
