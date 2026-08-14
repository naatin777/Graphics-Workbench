import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { isRasterImagePath, sourceFormatForPath } from '@graphics-workbench/core/formats';
import {
  executeRasterConversion,
  rasterFormatSpecs,
  createPdfRenderBackend,
} from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  createTestRuntime,
  listInputTestDataPathsSync,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
} from '@graphics-workbench/core/testing';

const unsupportedRasterTestDataRelativePaths = ['avif/animated-swirl.avif'];
const rasterInputDirectory = path.join(testInputDirectory, 'valid');
const rasterTestDataFormats = ['avif', 'gif', 'jpeg', 'tiff', 'webp'];
const supportedRasterTestDataPaths = rasterTestDataFormats
  .flatMap((format) => listInputTestDataPathsSync(path.join(rasterInputDirectory, format)))
  .filter(isRasterImagePath)
  .filter((testDataPath) => path.extname(testDataPath).toLowerCase() !== '.png')
  .filter(
    (testDataPath) =>
      !unsupportedRasterTestDataRelativePaths.includes(
        path.relative(rasterInputDirectory, testDataPath).split(path.sep).join('/'),
      ),
  );

describe('ラスターテストデータのPNG変換内容を固定正解と比較する', () => {
  for (const [index, testDataPath] of supportedRasterTestDataPaths.entries()) {
    it(`${path.relative(rasterInputDirectory, testDataPath)}をworkspaceへコピーし、複数フレームなら2ページ目を指定してPNGへ変換すると、テストデータ固定のexpected.pngと内容が一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const pdfRenderTools = createPdfRenderBackend();
        const sourcePath = await copyInputTestDataToWorkspace(testDataPath, index, workspacePath);
        const outputPath = path.join(workspacePath, 'converted outputs', `${index}.png`);
        const sourceFormat = sourceFormatForPath(testDataPath);
        assert.notStrictEqual(sourceFormat, undefined, testDataPath);
        const expectedPath = path.join(
          testOutputDirectory,
          sourceFormat ?? 'unknown',
          sourceName(testDataPath),
          'expected.png',
        );
        const page = await secondPageIfAnimated(sourcePath);

        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath, outputPath, workspacePath, ...(page === undefined ? {} : { page }) }],
          pdfRenderTools,
          runtime: createTestRuntime().runtime,
          runId: `raster-${index}`,
        });

        await assertRasterMatches(
          outputPath,
          expectedPath,
          `${testDataPath}${page === undefined ? '' : ` page ${page}`}`,
        );
      });
    });
  }

  it('avif/animated-swirl.avifをPNGへ変換するとunsupported image formatエラーで失敗し、出力ファイルも作成しない', async () => {
    const testDataPath = path.join(testInputDirectory, 'valid', unsupportedRasterTestDataRelativePaths[0] ?? '');

    await withTestWorkspace(async (workspacePath) => {
      const pdfRenderTools = createPdfRenderBackend();
      const sourcePath = await copyInputToWorkspace(testDataPath, workspacePath, 'unsupported sequence.avif');
      const outputPath = path.join(workspacePath, 'unsupported-output.png');

      await assert.rejects(
        executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath, outputPath, workspacePath }],
          pdfRenderTools,
          runtime: createTestRuntime().runtime,
          runId: 'unsupported-avif',
        }),
        /unsupported image format/u,
      );
      await assert.rejects(access(outputPath));
    });
  });
});

async function copyInputTestDataToWorkspace(
  testDataPath: string,
  index: number,
  workspacePath: string,
): Promise<string> {
  const destinationPath =
    index % 3 === 0
      ? `raster root input ${index}${path.extname(testDataPath)}`
      : index % 3 === 1
        ? `nested directory/diagram français 🚀 ${index}${path.extname(testDataPath)}`
        : `nested/δεδομένα/source.final ${index}${path.extname(testDataPath)}`;
  const sourcePath = await copyInputToWorkspace(testDataPath, workspacePath, destinationPath);
  return sourcePath;
}

async function secondPageIfAnimated(sourcePath: string): Promise<number | undefined> {
  const metadata = await sharp(sourcePath).metadata();
  return metadata.pages !== undefined && metadata.pages > 1 ? 2 : undefined;
}

function sourceName(testDataPath: string): string {
  return path.basename(testDataPath, path.extname(testDataPath));
}
