import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import {
  executeRasterConversion,
  rasterFormatSpecs,
  createPdfRenderBackend,
} from '@graphics-workbench/core/conversion';
import {
  copyInputToWorkspace,
  createTestRuntime,
  testInputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

const invalidCases = [
  { directory: 'avif', fileName: 'truncated.avif', outputFormat: 'png' },
  { directory: 'gif', fileName: 'truncated.gif', outputFormat: 'png' },
  { directory: 'jpeg', fileName: 'truncated.jpeg', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'not-a-pdf.pdf', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'password-protected.pdf', outputFormat: 'png' },
  { directory: 'pdf', fileName: 'truncated.pdf', outputFormat: 'png' },
  { directory: 'png', fileName: 'not-an-image.png', outputFormat: 'png' },
  { directory: 'png', fileName: 'truncated.png', outputFormat: 'png' },
  { directory: 'tiff', fileName: 'truncated.tiff', outputFormat: 'png' },
  { directory: 'webp', fileName: 'truncated.webp', outputFormat: 'png' },
] as const;

describe('不正なテスト入力の実変換エラー', () => {
  for (const [index, invalidCase] of invalidCases.entries()) {
    it(`${invalidCase.directory}/${invalidCase.fileName}を実際に${invalidCase.outputFormat.toUpperCase()}へ変換すると変換失敗となり、出力ファイルを生成しない`, async () => {
      const pdfRenderTools = createPdfRenderBackend();
      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'invalid', invalidCase.directory, invalidCase.fileName);
        const destinationPath = workspaceDestinationPath(invalidCase.fileName, index);
        const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, destinationPath);

        const outputPath = path.join(workspacePath, 'invalid input outputs', `${index}.${invalidCase.outputFormat}`);
        const input = executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath, outputPath, workspacePath }],
          pdfRenderTools,
          runtime: createTestRuntime().runtime,
          runId: `invalid-${index}`,
        });

        await assert.rejects(input, `${invalidCase.directory}/${invalidCase.fileName}`);
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
