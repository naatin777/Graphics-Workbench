import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import {
  readDrawioExecutablePath,
  readGhostscriptExecutablePath,
  readPdftocairoExecutablePath,
  readRsvgConvertExecutablePath,
} from '../../src/config/external_tools/external_tool_paths.js';
import { readMermaidPuppeteerOptions } from '../../src/config/rendering/mermaid_puppeteer_options.js';

export function readConfiguredConversionTools() {
  const configuration = getExtensionConfiguration();

  return {
    pdftocairoTools: { pdftocairoPath: readPdftocairoExecutablePath(configuration) },
    ghostscriptTools: { ghostscriptPath: readGhostscriptExecutablePath(configuration) },
    rsvgConvertPath: readRsvgConvertExecutablePath(configuration),
    mermaidTools: readMermaidPuppeteerOptions(configuration),
    drawioTools: { drawioPath: readDrawioExecutablePath(configuration) },
  };
}
