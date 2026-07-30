import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';
import { calculateRgbaDifference, readRgbaPixels } from '../helpers/raster_content.js';

const execFileAsync = promisify(execFile);

suite('SVG fixtureの内容比較', () => {
  test('source SVGをPNGへ変換し、独立rsvg-convert描画と一致する', async () => {
    const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(
      (fixturePath) => sourceFormatForPath(fixturePath) === 'svg',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-svg-fixtures-'));
    const outputDirectory = path.join(workspacePath, 'outputs');
    const expectedDirectory = path.join(workspacePath, 'expected');

    try {
      await Promise.all([mkdir(outputDirectory, { recursive: true }), mkdir(expectedDirectory, { recursive: true })]);
      const cases = await Promise.all(
        fixturePaths.map(async (fixturePath, index) => {
          const sourcePath = path.join(workspacePath, `${index}-${path.basename(fixturePath)}`);
          await copyFile(fixturePath, sourcePath);
          return {
            sourcePath,
            outputPath: path.join(outputDirectory, `${index}.png`),
            expectedPath: path.join(expectedDirectory, `${index}.png`),
          };
        }),
      );

      await executePngConversion({
        jobs: cases.map(({ sourcePath, outputPath }) => ({ sourcePath, outputPath, workspacePath })),
        pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
        ghostscriptTools: { ghostscriptPath: 'gs' },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'svg-fixtures',
      });

      for (const testCase of cases) {
        const actual = await readRgbaPixels(testCase.outputPath);
        await renderSvg(testCase.sourcePath, testCase.expectedPath, actual.width, actual.height);
        const expected = await readRgbaPixels(testCase.expectedPath);
        const difference = calculateRgbaDifference(expected, actual);

        assert.strictEqual(actual.width, expected.width);
        assert.strictEqual(actual.height, expected.height);
        assert.ok(
          difference.differentPixelRatio <= 0.01,
          `${path.basename(testCase.sourcePath)} changed ${difference.differentPixelRatio} of pixels`,
        );
        assert.ok(
          difference.meanChannelDifference <= 1,
          `${path.basename(testCase.sourcePath)} mean channel difference was ${difference.meanChannelDifference}`,
        );
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function renderSvg(sourcePath: string, outputPath: string, width: number, height: number): Promise<void> {
  await execFileAsync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', outputPath, sourcePath]);
}
