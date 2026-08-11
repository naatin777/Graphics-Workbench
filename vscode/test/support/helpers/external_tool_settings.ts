import { getExtensionConfiguration } from '../../../src/config/extension_configuration.js';
import {
  createPdfRenderBackend,
  type PdfRenderBackend,
} from '@graphics-workbench/core/operations/conversion/tools/pdf_render_tools.js';
import {
  executeDrawio,
  type DrawioBackend,
} from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';

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
