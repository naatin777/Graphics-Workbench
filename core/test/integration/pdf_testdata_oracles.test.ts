import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  executeRasterConversion,
  rasterFormatSpecs,
  createPdfRenderBackend,
} from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  createTestRuntime,
  copyInputToWorkspace,
  listInputTestDataPathsSync,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
  readPdfPages,
} from '@graphics-workbench/core/testing';

describe('PDFテスト入力の全ページPNG変換結果が、各ページの期待出力PNGと一致する', () => {
  for (const [index, testDataPath] of listInputTestDataPathsSync(
    path.join(testInputDirectory, 'valid', 'pdf'),
  ).entries()) {
    it(`pdf/${path.basename(testDataPath)}を読み取ったページ数分だけページごとにPNG変換し、各ページの出力が固定正解PNGと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const pdfRenderTools = createPdfRenderBackend();
        const sourcePath = await copyInputToWorkspace(
          testDataPath,
          workspacePath,
          workspaceSourcePath(testDataPath, index),
        );
        const sourcePages = await readPdfPages(await readFile(sourcePath));
        const outputDirectory = path.join(workspacePath, 'converted PDF pages', String(index));
        const expectedDirectory = path.join(testOutputDirectory, 'pdf', sourceName(testDataPath));
        const cases = Array.from({ length: sourcePages.length }, (_, pageIndex) => ({
          page: pageIndex + 1,
          outputPath: path.join(outputDirectory, `page-${String(pageIndex + 1).padStart(3, '0')}.png`),
        }));

        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: cases.map(({ outputPath, page }) => ({ sourcePath, outputPath, workspacePath, page })),
          pdfRenderTools,
          runtime: createTestRuntime().runtime,
          runId: `pdf-${index}`,
        });

        for (const testCase of cases) {
          await assertRasterMatches(
            testCase.outputPath,
            path.join(expectedDirectory, path.basename(testCase.outputPath)),
            `${testDataPath} page ${testCase.page}`,
          );
        }
      });
    });
  }
});

function workspaceSourcePath(testDataPath: string, index: number): string {
  const extension = path.extname(testDataPath);
  return index % 3 === 0
    ? `document root ${index}${extension}`
    : index % 3 === 1
      ? `documents with spaces/таблица ${index}${extension}`
      : `nested/مرحلة/diagram.${index}${extension}`;
}

function sourceName(testDataPath: string): string {
  return path.basename(testDataPath, path.extname(testDataPath));
}
