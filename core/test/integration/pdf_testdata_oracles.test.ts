import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { convertSplitPng, type ConversionSource } from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  listInputTestDataPathsSync,
  readPdfPages,
  testConversionConfiguration,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

describe('PDFテスト入力の全ページPNG変換結果が、各ページの期待出力PNGと一致する', () => {
  for (const [index, testDataPath] of listInputTestDataPathsSync(
    path.join(testInputDirectory, 'valid', 'pdf'),
  ).entries()) {
    it(`pdf/${path.basename(testDataPath)}を読み取ったページ数分だけページごとにPNG変換し、各ページの出力が固定正解PNGと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputToWorkspace(
          testDataPath,
          workspacePath,
          workspaceSourcePath(testDataPath, index),
        );
        const source: ConversionSource = {
          sourcePath,
          workspacePath,
          workspaceName: path.basename(workspacePath),
        };
        const sourcePages = await readPdfPages(await readFile(sourcePath));
        const expectedDirectory = path.join(testOutputDirectory, 'pdf', sourceName(testDataPath));

        const result = await convertSplitPng(
          [source],
          `\${fileDirname}/converted PDF pages/${index}/page-\${page}.png`,
          testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
          {},
        );
        if (result.isErr()) {
          throw result.error;
        }

        assert.strictEqual(result.value.length, sourcePages.length);
        for (const [outputIndex, output] of result.value.entries()) {
          const page = outputIndex + 1;
          await assertRasterMatches(
            output.outputPath,
            path.join(expectedDirectory, `page-${String(page).padStart(3, '0')}.png`),
            `${testDataPath} page ${page}`,
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
