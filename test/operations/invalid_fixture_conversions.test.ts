import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { executePngConversion } from '../../src/operations/conversion/raster_conversion.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

const invalidCases = [
  { directory: 'avif', fileName: 'truncated.avif', outputFormat: 'png' },
  { directory: 'gif', fileName: 'truncated.gif', outputFormat: 'png' },
  { directory: 'jpeg', fileName: 'truncated.jpeg', outputFormat: 'png' },
  { directory: 'mermaid', fileName: 'malformed.mmd', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'not-a-pdf.pdf', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'password-protected.pdf', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'truncated.pdf', outputFormat: 'png' },
  { directory: 'png', fileName: 'not-an-image.png', outputFormat: 'png' },
  { directory: 'png', fileName: 'truncated.png', outputFormat: 'png' },
  { directory: 'svg', fileName: 'malformed.svg', outputFormat: 'png' },
  { directory: 'tiff', fileName: 'truncated.tiff', outputFormat: 'png' },
  { directory: 'webp', fileName: 'truncated.webp', outputFormat: 'png' },
] as const;

suite('invalid fixtureの実変換エラー', () => {
  for (const [index, invalidCase] of invalidCases.entries()) {
    test(`${invalidCase.directory}/${invalidCase.fileName}を${invalidCase.outputFormat.toUpperCase()}へ実変換すると失敗し、出力を残さない`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const { pdfRenderTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const inputPath = path.join(testInputDirectory, 'invalid', invalidCase.directory, invalidCase.fileName);
        const destinationPath = workspaceDestinationPath(invalidCase.fileName, index);
        const sourcePath = await copyInputToWorkspace(inputPath, destinationPath);

        const outputPath = path.join(
          workspacePath,
          'invalid conversion outputs',
          `${index}.${invalidCase.outputFormat}`,
        );
        const conversion = executePngConversion({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          pdfRenderTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `invalid-${index}`,
        });

        await assert.rejects(conversion, `${invalidCase.directory}/${invalidCase.fileName}`);
        await assert.rejects(access(outputPath));
      });
    });
  }
});

function workspaceDestinationPath(fileName: string, index: number): string {
  const extension = path.extname(fileName);
  return index % 4 === 0
    ? `invalid root ${index}${extension}`
    : index % 4 === 1
      ? `bad inputs/файл ${index}${extension}`
      : index % 4 === 2
        ? `erroneous/élément ${index} 🚧${extension}`
        : `broken/δοκιμή/${index}.final${extension}`;
}
