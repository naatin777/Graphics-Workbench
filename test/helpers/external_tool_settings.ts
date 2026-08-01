import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import {
  readDrawioExecutablePath,
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../src/config/rendering/mermaid_puppeteer_options.js';
import type { MermaidBackend } from '../../src/operations/conversion/tools/index.js';

export function readConfiguredQpdfPath(): string {
  return getExtensionConfiguration().execPath.qpdf();
}

export function readConfiguredConversionTools(): {
  pdftocairoTools: { pdftocairoPath: string };
  ghostscriptTools: { ghostscriptPath: string };
  rsvgConvertPath: string;
  mermaidTools: MermaidBackend;
  drawioTools: { drawioPath: string };
} {
  const configuration = getExtensionConfiguration();

  return {
    pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration) },
    ghostscriptTools: { ghostscriptPath: readGhostscriptExecutablePath(configuration) },
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    mermaidTools: readMermaidPuppeteerOptions(configuration),
    drawioTools: { drawioPath: readDrawioExecutablePath(configuration) },
  };
}
