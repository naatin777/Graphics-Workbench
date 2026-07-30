import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

import { isRasterImagePath, sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToRawFiles } from '../../src/operations/conversion/convert_to_raw.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertRasterMatches } from '../helpers/content_assertions.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

const unsupportedRasterFixtureRelativePaths = ['avif/animated-swirl.avif'];
const rasterInputDirectory = path.join(testInputDirectory, 'valid');
const rasterFixtureFormats = ['avif', 'gif', 'jpeg', 'raw', 'tiff', 'webp'];
const supportedRasterFixturePaths = rasterFixtureFormats
  .flatMap((format) => listInputFixturePathsSync(path.join(rasterInputDirectory, format)))
  .filter(isRasterImagePath)
  .filter((fixturePath) => path.extname(fixturePath).toLowerCase() !== '.png')
  .filter(
    (fixturePath) => !unsupportedRasterFixtureRelativePaths.includes(path.relative(rasterInputDirectory, fixturePath)),
  );
const pngFixturePaths = listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'png')).filter((fixturePath) =>
  fixturePath.endsWith('.png'),
);

suite('ラスターfixtureの内容比較', () => {
  for (const [index, fixturePath] of supportedRasterFixturePaths.entries()) {
    test(`${path.relative(rasterInputDirectory, fixturePath)}をPNGへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputFixtureToWorkspace(fixturePath, index);
        const outputPath = path.join(workspacePath, 'converted outputs', `${index}.png`);
        const sourceFormat = sourceFormatForPath(fixturePath);
        assert.notStrictEqual(sourceFormat, undefined, fixturePath);
        const expectedPath = path.join(
          testOutputDirectory,
          sourceFormat ?? 'unknown',
          sourceName(fixturePath),
          'expected.png',
        );
        const page = await secondPageIfAnimated(sourcePath);

        await executePngConversion({
          jobs: [{ sourcePath, outputPath, workspacePath, ...(page === undefined ? {} : { page }) }],
          pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
          ghostscriptTools: { ghostscriptPath: 'gs' },
          mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
          drawioTools: { drawioPath: 'drawio' },
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `raster-${index}`,
        });

        await assertRasterMatches(
          outputPath,
          expectedPath,
          `${fixturePath}${page === undefined ? '' : ` page ${page}`}`,
        );
      });
    });
  }

  for (const [index, fixturePath] of pngFixturePaths.entries()) {
    test(`png/${path.basename(fixturePath)}をRawへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputFixtureToWorkspace(fixturePath, index);
        const outputPath = path.join(workspacePath, 'raw outputs', `${index}.raw`);
        const expectedDirectory = path.join(testOutputDirectory, 'png', sourceName(fixturePath));

        await convertToRawFiles({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `png-to-raw-${index}`,
        });

        await assertRasterMatches(
          outputPath,
          path.join(expectedDirectory, 'expected.raw'),
          `${fixturePath} raw output`,
        );
      });
    });
  }

  test('avif/animated-swirl.avifをPNGへ変換すると未対応sequenceとして出力を残さず失敗する', async () => {
    const fixturePath = path.join(testInputDirectory, 'valid', unsupportedRasterFixtureRelativePaths[0] ?? '');

    await withTestWorkspace(async (workspacePath) => {
      const sourcePath = await copyInputToWorkspace(fixturePath, 'unsupported sequence.avif');
      const outputPath = path.join(workspacePath, 'unsupported-output.png');

      await assert.rejects(
        executePngConversion({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
          ghostscriptTools: { ghostscriptPath: 'gs' },
          mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
          drawioTools: { drawioPath: 'drawio' },
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: 'unsupported-avif',
        }),
        /unsupported image format/u,
      );
      await assert.rejects(access(outputPath));
    });
  });
});

async function copyInputFixtureToWorkspace(fixturePath: string, index: number): Promise<string> {
  const destinationPath =
    index % 3 === 0
      ? `raster root input ${index}${path.extname(fixturePath)}`
      : index % 3 === 1
        ? `nested directory/diagram français 🚀 ${index}${path.extname(fixturePath)}`
        : `nested/δεδομένα/source.final ${index}${path.extname(fixturePath)}`;
  const sourcePath = await copyInputToWorkspace(fixturePath, destinationPath);
  if (fixturePath.endsWith('.raw')) {
    await copyInputToWorkspace(`${fixturePath}.json`, `${destinationPath}.json`);
  }
  return sourcePath;
}

async function secondPageIfAnimated(sourcePath: string): Promise<number | undefined> {
  if (sourcePath.endsWith('.raw')) {
    return undefined;
  }

  const metadata = await sharp(sourcePath).metadata();
  return metadata.pages !== undefined && metadata.pages > 1 ? 2 : undefined;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
