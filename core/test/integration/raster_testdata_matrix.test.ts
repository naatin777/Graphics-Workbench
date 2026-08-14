import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { isRasterImagePath, sourceFormatForPath } from '@graphics-workbench/core/formats';
import { convertSinglePng, convertSplitPng, type ConversionSource } from '@graphics-workbench/core/conversion';
import {
  assertRasterMatches,
  copyInputToWorkspace,
  listInputTestDataPathsSync,
  testConversionConfiguration,
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
        const sourcePath = await copyInputTestDataToWorkspace(testDataPath, index, workspacePath);
        const sourceFormat = sourceFormatForPath(testDataPath);
        assert.notStrictEqual(sourceFormat, undefined, testDataPath);
        const expectedPath = path.join(
          testOutputDirectory,
          sourceFormat ?? 'unknown',
          sourceName(testDataPath),
          'expected.png',
        );
        const source: ConversionSource = {
          sourcePath,
          workspacePath,
          workspaceName: path.basename(workspacePath),
        };

        const result = await convertSplitPng(
          [source],
          `\${fileDirname}/converted outputs/${index}-\${page}.png`,
          testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
          {},
        );
        if (result.isErr()) {
          throw result.error;
        }

        const output = result.value.length > 1 ? result.value[1] : result.value[0];
        assert.ok(output, `${testDataPath} should produce a PNG output`);
        const page = result.value.length > 1 ? 2 : undefined;
        await assertRasterMatches(
          output.outputPath,
          expectedPath,
          `${testDataPath}${page === undefined ? '' : ` page ${page}`}`,
        );
      });
    });
  }

  it('avif/animated-swirl.avifをPNGへ変換するとunsupported image formatエラーで失敗し、出力ファイルも作成しない', async () => {
    const testDataPath = path.join(testInputDirectory, 'valid', unsupportedRasterTestDataRelativePaths[0] ?? '');

    await withTestWorkspace(async (workspacePath) => {
      const sourcePath = await copyInputToWorkspace(testDataPath, workspacePath, 'unsupported sequence.avif');

      const result = await convertSinglePng(
        [{ sourcePath, workspacePath, workspaceName: path.basename(workspacePath) }],
        '${fileDirname}/unsupported-output.png',
        testConversionConfiguration({ maxInputPixels: 1_000_000_000 }),
        {},
      );

      assert.ok(result.isErr(), 'animated AVIF should not convert to PNG');
      assert.match(result.error.message, /unsupported image format/u);
      await assert.rejects(access(path.join(workspacePath, 'unsupported-output.png')));
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
  return copyInputToWorkspace(testDataPath, workspacePath, destinationPath);
}

function sourceName(testDataPath: string): string {
  return path.basename(testDataPath, path.extname(testDataPath));
}
