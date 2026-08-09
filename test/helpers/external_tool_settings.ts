import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import {
  readDrawioExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { readMermaidCliOptions } from '../../src/config/rendering/mermaid_cli_options.js';
import type { MermaidBackend } from '../../src/operations/conversion/tools/mermaid_tools.js';
import type { PdfRenderBackend } from '../../src/operations/conversion/tools/pdf_render_tools.js';
import { executeDrawio, type DrawioBackend } from '../../src/operations/conversion/tools/drawio_tools.js';

export function readConfiguredConversionTools(): {
  pdfRenderTools: PdfRenderBackend;
  rsvgConvertPath: string;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
} {
  const configuration = getExtensionConfiguration();

  return {
    pdfRenderTools: {},
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    mermaidTools: readMermaidCliOptions(configuration),
    drawioTools: { drawioPath: readDrawioExecutablePath(configuration), runDrawio: executeDrawio },
  };
}
