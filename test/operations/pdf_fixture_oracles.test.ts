import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';

import { executePngConversion } from '../../src/operations/conversion/raster_conversion.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertRasterMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

suite('PDFテスト入力の全ページPNG変換結果が、各ページの期待出力PNGと一致する', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(
    path.join(testInputDirectory, 'valid', 'pdf'),
  ).entries()) {
    test(`pdf/${path.basename(fixturePath)}を読み取ったページ数分だけページごとにPNG変換し、各ページの出力が固定正解PNGと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const { pdfRenderTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const document = await PDFDocument.load(await readFile(sourcePath));
        const outputDirectory = path.join(workspacePath, 'converted PDF pages', String(index));
        const expectedDirectory = path.join(testOutputDirectory, 'pdf', sourceName(fixturePath));
        const cases = Array.from({ length: document.getPageCount() }, (_, pageIndex) => ({
          page: pageIndex + 1,
          outputPath: path.join(outputDirectory, `page-${String(pageIndex + 1).padStart(3, '0')}.png`),
        }));

        await executePngConversion({
          jobs: cases.map(({ outputPath, page }) => ({ sourcePath, outputPath, workspacePath, page })),
          pdfRenderTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `pdf-${index}`,
        });

        for (const testCase of cases) {
          await assertRasterMatches(
            testCase.outputPath,
            path.join(expectedDirectory, path.basename(testCase.outputPath)),
            `${fixturePath} page ${testCase.page}`,
          );
        }
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index % 3 === 0
    ? `document root ${index}${extension}`
    : index % 3 === 1
      ? `documents with spaces/таблица ${index}${extension}`
      : `nested/مرحلة/diagram.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
