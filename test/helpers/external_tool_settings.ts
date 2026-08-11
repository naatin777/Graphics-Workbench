import { getExtensionConfiguration } from '../../vscode/src/config/extension_configuration.js';
import { createMermaidBackend } from '../../vscode/src/config/rendering/mermaid_cli_options.js';
import type { MermaidBackend } from '@graphics-workbench/core/operations/conversion/tools/mermaid_tools.js';
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
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
} {
  const configuration = getExtensionConfiguration();

  return {
    pdfRenderTools: createPdfRenderBackend(),
    rsvgConvertPath: configuration.execPath.rsvgConvert(),
    mermaidTools: createMermaidBackend(configuration),
    drawioTools: { drawioPath: configuration.execPath.drawio(), runDrawio: executeDrawio },
  };
}
