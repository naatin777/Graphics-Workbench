import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument } from 'pdf-lib';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';
import { readRgbaPixels } from '../helpers/raster_content.js';

const execFileAsync = promisify(execFile);

suite('PDF fixtureの内容比較', () => {
  test('source PDFの全ページをPNGへ変換し、独立描画結果と一致する', async () => {
    const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(
      (fixturePath) => sourceFormatForPath(fixturePath) === 'pdf',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-pdf-fixtures-'));
    const outputDirectory = path.join(workspacePath, 'outputs');
    const expectedDirectory = path.join(workspacePath, 'expected');

    try {
      await Promise.all([mkdir(outputDirectory, { recursive: true }), mkdir(expectedDirectory, { recursive: true })]);
      const cases = await createPdfPageCases(fixturePaths, workspacePath, outputDirectory);

      await executePngConversion({
        jobs: cases.map(({ sourcePath, outputPath, page }) => ({ sourcePath, outputPath, workspacePath, page })),
        pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
        ghostscriptTools: { ghostscriptPath: 'gs' },
        mermaidTools: { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'pdf-fixtures',
      });

      for (const [index, testCase] of cases.entries()) {
        const expectedPath = path.join(expectedDirectory, `${index}.png`);
        await renderPdfPage(testCase.sourcePath, testCase.page, expectedPath);
        assert.deepStrictEqual(
          await readRgbaPixels(testCase.outputPath),
          await readRgbaPixels(expectedPath),
          `Rendered PDF page changed for ${path.basename(testCase.sourcePath)} page ${testCase.page}`,
        );
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

interface PdfPageCase {
  sourcePath: string;
  outputPath: string;
  page: number;
}

async function createPdfPageCases(
  fixturePaths: string[],
  workspacePath: string,
  outputDirectory: string,
): Promise<PdfPageCase[]> {
  const cases: PdfPageCase[] = [];

  for (const [fixtureIndex, fixturePath] of fixturePaths.entries()) {
    const sourcePath = path.join(workspacePath, `${fixtureIndex}-${path.basename(fixturePath)}`);
    await copyFile(fixturePath, sourcePath);
    const document = await PDFDocument.load(await readFile(sourcePath));
    for (let page = 1; page <= document.getPageCount(); page += 1) {
      cases.push({
        sourcePath,
        outputPath: path.join(outputDirectory, `${fixtureIndex}-${page}.png`),
        page,
      });
    }
  }

  return cases;
}

async function renderPdfPage(sourcePath: string, page: number, outputPath: string): Promise<void> {
  const outputPrefix = outputPath.slice(0, -path.extname(outputPath).length);
  await execFileAsync('pdftocairo', [
    '-png',
    '-singlefile',
    '-f',
    String(page),
    '-l',
    String(page),
    sourcePath,
    outputPrefix,
  ]);
}
