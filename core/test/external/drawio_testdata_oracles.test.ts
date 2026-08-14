import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isDrawioImagePath } from '@graphics-workbench/core/formats';
import {
  convertDrawioToSinglePdf,
  convertToPdfFiles,
  convertToSvgFiles,
  executeDrawio,
  executeRasterConversion,
  rasterFormatSpecs,
} from '@graphics-workbench/core/conversion';
import {
  assertPdfMatches,
  assertRasterMatches,
  copyInputToWorkspace,
  createTestRuntime,
  defaultRasterMaxInputPixels,
  readConfiguredConversionTools,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
  requireConfiguredTool,
} from '@graphics-workbench/core/testing';

const execFileAsync = promisify(execFile);

const validCases = [
  {
    id: 'embedded-diagram',
    inputFileName: 'embedded-diagram.drawio.svg',
    workspaceSourcePath: 'root diagram.drawio.svg',
    outputDirectory: 'converted output/root case',
  },
  {
    id: 'multi-object-diagram',
    inputFileName: 'multi-object-diagram.drawio.png',
    workspaceSourcePath: 'テストデータs with spaces/diagram résumé 🚀.drawio.png',
    outputDirectory: '変換結果/PNG source',
  },
  {
    id: 'unicode-page-names',
    inputFileName: 'unicode-page-names.drawio',
    workspaceSourcePath: 'deep/nested/مرحلة/diagram.final.drawio',
    outputDirectory: 'deep/nested/outputs/native drawio',
  },
] as const;

const invalidCases = [
  { fileName: 'malformed.drawio', workspaceSourcePath: 'invalid root.drawio' },
  { fileName: 'plain-image.drawio.png', workspaceSourcePath: 'invalid inputs/файл.drawio.png' },
  { fileName: 'truncated-embedded-image.drawio.png', workspaceSourcePath: 'broken/élément 🚧.drawio.png' },
] as const;

describe('Draw.io テストデータの実変換と固定正解データの比較', () => {
  for (const testDataCase of validCases) {
    it(`${testDataCase.inputFileName}を実Draw.ioでPNG・SVG・PDFへ変換し、各出力を固定正解データ（expected.png・expected.svgのレンダリング・expected.pdf）と比較して一致することを検証する`, async () => {
      const configuredTools = readConfiguredConversionTools();
      const { drawioTools } = configuredTools;

      const { runtime } = createTestRuntime();

      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'valid', 'drawio', testDataCase.inputFileName);
        const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, testDataCase.workspaceSourcePath);
        const outputDirectory = path.join(workspacePath, testDataCase.outputDirectory);
        await mkdir(outputDirectory, { recursive: true });

        const actualPngPath = path.join(outputDirectory, 'actual.png');
        const actualSvgPath = path.join(outputDirectory, 'actual.svg');
        const actualPdfPath = path.join(outputDirectory, 'actual.pdf');
        const renderedActualSvgPath = path.join(outputDirectory, 'actual-svg.png');
        const renderedExpectedSvgPath = path.join(outputDirectory, 'expected-svg.png');
        const expectedDirectory = path.join(testOutputDirectory, 'drawio', testDataCase.id);

        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          inputs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          runtime,
          pdfRenderTools: configuredTools.pdfRenderTools,
          drawioTools,
          maxInputPixels: defaultRasterMaxInputPixels,
          runId: `drawio-${testDataCase.id}-png`,
        });
        await convertToSvgFiles({
          inputs: [{ sourcePath, outputPath: actualSvgPath, workspacePath }],
          runtime: {},
          drawioTools,
          runPdfToSvg: () => {
            throw new Error('drawio テストデータ must not include PDF input for SVG input');
          },
          maxInputPixels: defaultRasterMaxInputPixels,
          runId: `drawio-${testDataCase.id}-svg`,
        });

        await (isDrawioImagePath(sourcePath)
          ? convertToPdfFiles({
              inputs: [{ sourcePath, outputPath: actualPdfPath, workspacePath }],
              tools: { drawioTools },
              maxInputPixels: defaultRasterMaxInputPixels,
              runtime,
              runId: `drawio-${testDataCase.id}-pdf`,
            })
          : convertDrawioToSinglePdf({
              inputs: [
                {
                  sourcePath,
                  outputTemplate: `\${workspaceFolder}/${testDataCase.outputDirectory}/actual.pdf`,
                  workspacePath,
                  workspaceName: path.basename(workspacePath),
                },
              ],
              drawioPath: drawioTools.drawioPath,
              runDrawio: executeDrawio,
              runtime,
              runId: `drawio-${testDataCase.id}-native-pdf`,
            }));

        await assertRasterMatches(actualPngPath, path.join(expectedDirectory, 'expected.png'), `PNG: ${sourcePath}`, {
          rendererVariance: true,
        });

        await renderSvg(actualSvgPath, renderedActualSvgPath, configuredTools.rsvgConvertPath);
        await renderSvg(
          path.join(expectedDirectory, 'expected.svg'),
          renderedExpectedSvgPath,
          configuredTools.rsvgConvertPath,
        );
        await assertRasterMatches(renderedActualSvgPath, renderedExpectedSvgPath, `SVG: ${sourcePath}`);

        await assertPdfMatches(
          actualPdfPath,
          path.join(expectedDirectory, 'expected.pdf'),
          path.join(outputDirectory, 'pdf-rendered'),
          sourcePath,
        );
      });
    });
  }

  for (const [index, invalidCase] of invalidCases.entries()) {
    it(`invalid/drawio/${invalidCase.fileName}を実Draw.ioでPDFへ実変換すると失敗し、出力PDFを作成しない`, async () => {
      const drawioPath = requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io');

      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'invalid', 'drawio', invalidCase.fileName);
        const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, invalidCase.workspaceSourcePath);
        const input = convertDrawioToSinglePdf({
          inputs: [
            {
              sourcePath,
              outputTemplate: `\${workspaceFolder}/invalid-output-${index}.pdf`,
              workspacePath,
              workspaceName: path.basename(workspacePath),
            },
          ],
          drawioPath,
          runDrawio: executeDrawio,
          runtime: createTestRuntime().runtime,
          runId: `drawio-invalid-${index}`,
        });

        await assert.rejects(input, invalidCase.fileName);
        await assert.rejects(access(path.join(workspacePath, `invalid-output-${index}.pdf`)));
      });
    });
  }
});

async function renderSvg(sourcePath: string, outputPath: string, rsvgConvertPath: string): Promise<void> {
  await execFileAsync(rsvgConvertPath, ['-o', outputPath, sourcePath]);
}
