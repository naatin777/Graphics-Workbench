import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { run as runMermaidCli } from '@mermaid-js/mermaid-cli';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';
import { calculateRgbaDifference, readRgbaPixels } from '../helpers/raster_content.js';

const execFileAsync = promisify(execFile);

suite('Mermaid fixtureの内容比較', () => {
  test('3種類のsource MermaidをPNG/SVG/PDFへ変換し、直接CLI描画と一致する', async () => {
    const fixturePaths = (await listInputFixturePaths(sourceFixtureDirectory)).filter(
      (fixturePath) => sourceFormatForPath(fixturePath) === 'mermaid',
    );
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-fixtures-'));
    const outputDirectory = path.join(workspacePath, 'outputs');
    const expectedDirectory = path.join(workspacePath, 'expected');
    const renderedDirectory = path.join(workspacePath, 'rendered');

    try {
      await Promise.all([
        mkdir(outputDirectory, { recursive: true }),
        mkdir(expectedDirectory, { recursive: true }),
        mkdir(renderedDirectory, { recursive: true }),
      ]);
      const cases = await Promise.all(
        fixturePaths.map(async (fixturePath, index) => {
          const sourcePath = path.join(workspacePath, `${index}-${path.basename(fixturePath)}`);
          await copyFile(fixturePath, sourcePath);
          return {
            sourcePath,
            outputPngPath: path.join(outputDirectory, `${index}.png`),
            outputSvgPath: path.join(outputDirectory, `${index}.svg`),
            outputPdfPath: path.join(outputDirectory, `${index}.pdf`),
            expectedPngPath: mermaidOutputPath(expectedDirectory, index, 'png'),
            expectedSvgPath: mermaidOutputPath(expectedDirectory, index, 'svg'),
            expectedPdfPath: mermaidOutputPath(expectedDirectory, index, 'pdf'),
            renderedActualSvgPath: path.join(renderedDirectory, `${index}-actual-svg.png`),
            renderedExpectedSvgPath: path.join(renderedDirectory, `${index}-expected-svg.png`),
            renderedActualPdfPath: path.join(renderedDirectory, `${index}-actual-pdf.png`),
            renderedExpectedPdfPath: path.join(renderedDirectory, `${index}-expected-pdf.png`),
          };
        }),
      );
      const mermaidTools = { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' } as const;

      await executePngConversion({
        jobs: cases.map(({ sourcePath, outputPngPath }) => ({
          sourcePath,
          outputPath: outputPngPath,
          workspacePath,
        })),
        pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
        ghostscriptTools: { ghostscriptPath: 'gs' },
        mermaidTools,
        drawioTools: { drawioPath: 'drawio' },
        runtime: { resolveConflicts: async () => 'overwrite' },
        runId: 'mermaid-fixtures-png',
      });
      await convertToSvgFiles({
        jobs: cases.map(({ sourcePath, outputSvgPath }) => ({
          sourcePath,
          outputPath: outputSvgPath,
          workspacePath,
        })),
        pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
        ghostscriptTools: { ghostscriptPath: 'gs' },
        mermaidTools,
        drawioTools: { drawioPath: 'drawio' },
        runId: 'mermaid-fixtures-svg',
      });
      await convertToPdfFiles({
        jobs: cases.map(({ sourcePath, outputPdfPath }) => ({
          sourcePath,
          outputPath: outputPdfPath,
          workspacePath,
        })),
        supportedExtensions: ['.mmd', '.mermaid'],
        tools: { mermaidTools },
        runtime: { resolveConflicts: async () => 'overwrite' },
        operationName: 'mermaid-fixtures-to-pdf',
        runId: 'mermaid-fixtures-pdf',
      });

      for (const testCase of cases) {
        await runMermaidExpected(testCase.sourcePath, testCase.expectedPngPath, 'png');
        await runMermaidExpected(testCase.sourcePath, testCase.expectedSvgPath, 'svg');
        await runMermaidExpected(testCase.sourcePath, testCase.expectedPdfPath, 'pdf');

        await assertSimilarPngs(testCase.outputPngPath, testCase.expectedPngPath, testCase.sourcePath);
        await renderSvg(testCase.outputSvgPath, testCase.renderedActualSvgPath);
        await renderSvg(testCase.expectedSvgPath, testCase.renderedExpectedSvgPath);
        await assertSimilarPngs(testCase.renderedActualSvgPath, testCase.renderedExpectedSvgPath, testCase.sourcePath);
        await renderPdf(testCase.outputPdfPath, testCase.renderedActualPdfPath);
        await renderPdf(testCase.expectedPdfPath, testCase.renderedExpectedPdfPath);
        await assertSimilarPngs(testCase.renderedActualPdfPath, testCase.renderedExpectedPdfPath, testCase.sourcePath);
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

type MermaidOutputFormat = 'png' | 'svg' | 'pdf';
type MermaidOutputPath = `${string}.${MermaidOutputFormat}`;

function mermaidOutputPath(directory: string, index: number, outputFormat: MermaidOutputFormat): MermaidOutputPath {
  return `${path.join(directory, String(index))}.${outputFormat}`;
}

async function runMermaidExpected(
  sourcePath: string,
  outputPath: MermaidOutputPath,
  outputFormat: MermaidOutputFormat,
): Promise<void> {
  await runMermaidCli(sourcePath, outputPath, {
    outputFormat,
    puppeteerConfig: { headless: true, channel: 'chrome' },
    quiet: true,
    parseMMDOptions: {
      backgroundColor: 'white',
      mermaidConfig: { theme: 'default' },
    },
  });
}

async function renderSvg(sourcePath: string, outputPath: string): Promise<void> {
  await execFileAsync('rsvg-convert', ['-o', outputPath, sourcePath]);
}

async function renderPdf(sourcePath: string, outputPath: string): Promise<void> {
  const outputPrefix = outputPath.slice(0, -path.extname(outputPath).length);
  await execFileAsync('pdftocairo', ['-png', '-singlefile', '-f', '1', '-l', '1', sourcePath, outputPrefix]);
}

async function assertSimilarPngs(actualPath: string, expectedPath: string, sourcePath: string): Promise<void> {
  const actual = await readRgbaPixels(actualPath);
  const expected = await readRgbaPixels(expectedPath);
  const difference = calculateRgbaDifference(expected, actual);

  assert.strictEqual(actual.width, expected.width, sourcePath);
  assert.strictEqual(actual.height, expected.height, sourcePath);
  assert.ok(difference.differentPixelRatio <= 0.01, sourcePath);
  assert.ok(difference.meanChannelDifference <= 1, sourcePath);
}
