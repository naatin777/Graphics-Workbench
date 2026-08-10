import { readFile, writeFile } from 'node:fs/promises';

import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import { readMermaidCliOptions } from '../../src/config/rendering/mermaid_cli_options.js';
import type { MermaidBackend } from '../../src/operations/conversion/tools/mermaid_tools.js';
import type { PdfRenderBackend } from '../../src/operations/conversion/tools/pdf_render_tools.js';
import { executeDrawio, type DrawioBackend } from '../../src/operations/conversion/tools/drawio_tools.js';
import { renderPdfPageToPng } from '../../src/operations/pdf/mupdf.js';

export function readConfiguredConversionTools(): {
  pdfRenderTools: PdfRenderBackend;
  rsvgConvertPath: string;
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
} {
  const configuration = getExtensionConfiguration();

  return {
    pdfRenderTools: {
      runPdfToPng: async (sourcePath, outputPath, page, signal, cropContent) => {
        signal.throwIfAborted();
        const pdfBytes = await readFile(sourcePath);
        signal.throwIfAborted();
        const png = await renderPdfPageToPng(pdfBytes, page, {
          ...(cropContent !== undefined && { cropContent }),
        });
        signal.throwIfAborted();
        await writeFile(outputPath, png);
      },
    },
    rsvgConvertPath: configuration.execPath.rsvgConvert(),
    mermaidTools: readMermaidCliOptions(configuration),
    drawioTools: { drawioPath: configuration.execPath.drawio(), runDrawio: executeDrawio },
  };
}
