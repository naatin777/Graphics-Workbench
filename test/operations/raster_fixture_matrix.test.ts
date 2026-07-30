import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { isRasterImagePath } from '../../src/application/policy/source_format.js';
import { convertToRawFiles } from '../../src/operations/conversion/convert_to_raw.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';
import { readRgbaPixels } from '../helpers/raster_content.js';

const unsupportedRasterFixtureRelativePaths = ['avif/animated-swirl.avif'];

suite('ラスターfixtureの内容比較', () => {
  test('Sharpで処理可能なsourceラスターfixtureをPNGへ変換し、RGBA画素を保持する', async () => {
    const fixturePaths = (await supportedRasterFixturePaths()).filter(
      (fixturePath) => path.extname(fixturePath).toLowerCase() !== '.png',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-raster-fixtures-'));
    const outputDirectory = path.join(workspacePath, 'outputs');

    try {
      await mkdir(outputDirectory, { recursive: true });
      const cases = await Promise.all(
        fixturePaths.map(async (fixturePath, index) => {
          const sourcePath = path.join(workspacePath, path.basename(fixturePath));
          const outputPath = path.join(outputDirectory, `${index}.png`);
          await copyFixture(fixturePath, sourcePath);
          const page = await secondPageIfAnimated(sourcePath);
          return { sourcePath, outputPath, page };
        }),
      );

      await executePngConversion({
        jobs: cases.map(({ sourcePath, outputPath, page }) => ({
          sourcePath,
          outputPath,
          workspacePath,
          ...(page === undefined ? {} : { page }),
        })),
        pdftocairoTools: { pdftocairoPath: '/opt/homebrew/bin/pdftocairo' },
        ghostscriptTools: { ghostscriptPath: '/opt/homebrew/bin/gs' },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'raster-fixtures',
      });

      for (const testCase of cases) {
        const expected = await readRgbaPixels(testCase.sourcePath, testCase.page);
        const actual = await readRgbaPixels(testCase.outputPath);
        assert.deepStrictEqual(
          actual,
          expected,
          `Decoded pixels changed for ${path.basename(testCase.sourcePath)}${testCase.page === undefined ? '' : ` page ${testCase.page}`}`,
        );
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('PNG source fixtureをRawへ変換し、RGBA画素を保持する', async () => {
    const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(
      (fixturePath) => path.extname(fixturePath).toLowerCase() === '.png',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-png-to-raw-fixtures-'));

    try {
      const cases = await Promise.all(
        fixturePaths.map(async (fixturePath, index) => {
          const sourcePath = path.join(workspacePath, path.basename(fixturePath));
          const outputPath = path.join(workspacePath, `output-${index}.raw`);
          await copyFixture(fixturePath, sourcePath);
          return { sourcePath, outputPath };
        }),
      );

      await convertToRawFiles({
        jobs: cases.map(({ sourcePath, outputPath }) => ({ sourcePath, outputPath, workspacePath })),
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'png-to-raw-fixtures',
      });

      for (const testCase of cases) {
        assert.deepStrictEqual(await readRgbaPixels(testCase.outputPath), await readRgbaPixels(testCase.sourcePath));
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('Sharpが対応しないAVIF sequenceは出力を残さず失敗する', async () => {
    const fixturePath = path.join(sourceFixtureDirectory, unsupportedRasterFixtureRelativePaths[0] ?? '');
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-unsupported-avif-'));
    const sourcePath = path.join(workspacePath, path.basename(fixturePath));
    const outputPath = path.join(workspacePath, 'output.png');

    try {
      await copyFile(fixturePath, sourcePath);
      await assert.rejects(
        executePngConversion({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          pdftocairoTools: { pdftocairoPath: '/opt/homebrew/bin/pdftocairo' },
          ghostscriptTools: { ghostscriptPath: '/opt/homebrew/bin/gs' },
          mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
          drawioTools: { drawioPath: 'drawio' },
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: 'unsupported-avif',
        }),
        /unsupported image format/u,
      );
      await assert.rejects(readFile(outputPath));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function supportedRasterFixturePaths(): Promise<string[]> {
  const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(isRasterImagePath);
  const unsupportedPaths = fixturePaths
    .filter((fixturePath) =>
      unsupportedRasterFixtureRelativePaths.includes(path.relative(sourceFixtureDirectory, fixturePath)),
    )
    .map((fixturePath) => path.relative(sourceFixtureDirectory, fixturePath));
  assert.deepStrictEqual(unsupportedPaths, unsupportedRasterFixtureRelativePaths);
  return fixturePaths.filter(
    (fixturePath) =>
      !unsupportedRasterFixtureRelativePaths.includes(path.relative(sourceFixtureDirectory, fixturePath)),
  );
}

async function copyFixture(fixturePath: string, sourcePath: string): Promise<void> {
  await copyFile(fixturePath, sourcePath);
  if (fixturePath.endsWith('.raw')) {
    await copyFile(`${fixturePath}.json`, `${sourcePath}.json`);
  }
}

async function secondPageIfAnimated(sourcePath: string): Promise<number | undefined> {
  if (sourcePath.endsWith('.raw')) {
    return undefined;
  }

  const metadata = await sharp(sourcePath).metadata();
  return metadata.pages !== undefined && metadata.pages > 1 ? 2 : undefined;
}
