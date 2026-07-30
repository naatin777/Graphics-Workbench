import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';
import { calculateRgbaDifference, readRgbaPixels } from '../helpers/raster_content.js';

const execFileAsync = promisify(execFile);

suite('EPS fixtureの内容比較', () => {
  test('source EPSをPDF/PNGへ変換し、独立Ghostscript経路と一致する', async () => {
    const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(
      (fixturePath) => sourceFormatForPath(fixturePath) === 'eps',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-eps-fixtures-'));
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
            outputPdfPath: path.join(outputDirectory, `${index}.pdf`),
            outputPngPath: path.join(outputDirectory, `${index}.png`),
            expectedPdfPath: path.join(expectedDirectory, `${index}.pdf`),
            expectedPngPath: path.join(expectedDirectory, `${index}.png`),
          };
        }),
      );

      await convertToPdfFiles({
        jobs: cases.map(({ sourcePath, outputPdfPath }) => ({
          sourcePath,
          outputPath: outputPdfPath,
          workspacePath,
        })),
        tools: { ghostscriptPath: 'gs' },
        supportedExtensions: ['.eps'],
        runtime: { resolveConflicts: async () => 'overwrite' },
        operationName: 'eps-fixtures-to-pdf',
        runId: 'eps-fixtures-pdf',
      });
      await executePngConversion({
        jobs: cases.map(({ sourcePath, outputPngPath }) => ({
          sourcePath,
          outputPath: outputPngPath,
          workspacePath,
        })),
        pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
        ghostscriptTools: { ghostscriptPath: 'gs' },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'eps-fixtures-png',
      });

      for (const testCase of cases) {
        await renderWithGhostscript(testCase.sourcePath, testCase.expectedPdfPath, testCase.expectedPngPath);
        await assertSamePageSize(testCase.outputPdfPath, testCase.expectedPdfPath);

        const actual = await readRgbaPixels(testCase.outputPngPath);
        const expected = await readRgbaPixels(testCase.expectedPngPath);
        const difference = calculateRgbaDifference(expected, actual);
        assert.strictEqual(actual.width, expected.width);
        assert.strictEqual(actual.height, expected.height);
        assert.ok(difference.differentPixelRatio <= 0.01);
        assert.ok(difference.meanChannelDifference <= 1);
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function renderWithGhostscript(sourcePath: string, pdfPath: string, pngPath: string): Promise<void> {
  await execFileAsync('gs', [
    '-dSAFER',
    '-dNOPAUSE',
    '-dBATCH',
    '-dEPSCrop',
    '-sDEVICE=pdfwrite',
    `-sOutputFile=${pdfPath}`,
    sourcePath,
  ]);
  const outputPrefix = pngPath.slice(0, -path.extname(pngPath).length);
  await execFileAsync('pdftocairo', ['-png', '-singlefile', '-f', '1', '-l', '1', pdfPath, outputPrefix]);
}

async function assertSamePageSize(actualPath: string, expectedPath: string): Promise<void> {
  const [actual, expected] = await Promise.all([
    PDFDocument.load(await readFile(actualPath)),
    PDFDocument.load(await readFile(expectedPath)),
  ]);
  assert.strictEqual(actual.getPageCount(), 1);
  assert.strictEqual(expected.getPageCount(), 1);
  assert.deepStrictEqual(actual.getPage(0).getSize(), expected.getPage(0).getSize());
}
