import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import {
  readDrawioExecutablePath,
  readPdftocairoExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { readMermaidCliOptions } from '../../src/config/rendering/mermaid_cli_options.js';
import type { MermaidBackend } from '../../src/operations/conversion/tools/index.js';

export function readConfiguredConversionTools(): {
  pdftocairoTools: { pdftocairoPath: string };
  rsvgConvertPath: string;
  mermaidTools: MermaidBackend;
  drawioTools: { drawioPath: string };
} {
  const configuration = getExtensionConfiguration();

  return {
    pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration) },
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    mermaidTools: readMermaidCliOptions(configuration),
    drawioTools: { drawioPath: readDrawioExecutablePath(configuration) },
  };
}
