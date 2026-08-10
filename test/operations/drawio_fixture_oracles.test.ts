import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isEditableDrawioImagePath } from '../../src/shared/source_format.js';
import { convertDrawioToPdfFiles } from '../../src/operations/conversion/convert_drawio_to_pdf.js';
import { executeDrawio } from '../../src/operations/conversion/tools/drawio_tools.js';
import { executeRasterConversion, rasterFormatSpecs } from '../../src/operations/conversion/raster_conversion.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { getExtensionConfiguration } from '../../src/config/extension_configuration.js';
import { testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertPdfMatches, assertRasterMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

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
    workspaceSourcePath: 'fixtures with spaces/diagram résumé 🚀.drawio.png',
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

suite('Draw.io fixtureの実変換と固定正解データの比較', () => {
  for (const fixtureCase of validCases) {
    test(`${fixtureCase.inputFileName}を実Draw.ioでPNG・SVG・PDFへ変換し、各出力を固定正解データ（expected.png・expected.svgのレンダリング・expected.pdf）と比較して一致することを検証する`, async function convertsFixtureToExpectedOutputs() {
      const drawioPath = getExtensionConfiguration().execPath.drawio();
      if (drawioPath === '') {
        this.skip();
        return;
      }

      const configuredTools = readConfiguredConversionTools();
      if (configuredTools.rsvgConvertPath === '') {
        this.skip();
        return;
      }

      const runtime = { resolveConflicts: async () => 'overwrite' as const };

      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'valid', 'drawio', fixtureCase.inputFileName);
        const sourcePath = await copyInputToWorkspace(inputPath, fixtureCase.workspaceSourcePath);
        const outputDirectory = path.join(workspacePath, fixtureCase.outputDirectory);
        await mkdir(outputDirectory, { recursive: true });

        const actualPngPath = path.join(outputDirectory, 'actual.png');
        const actualSvgPath = path.join(outputDirectory, 'actual.svg');
        const actualPdfPath = path.join(outputDirectory, 'actual.pdf');
        const renderedActualSvgPath = path.join(outputDirectory, 'actual-svg.png');
        const renderedExpectedSvgPath = path.join(outputDirectory, 'expected-svg.png');
        const expectedDirectory = path.join(testOutputDirectory, 'drawio', fixtureCase.id);

        const drawioTools = { drawioPath, runDrawio: executeDrawio };
        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          jobs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          runtime,
          pdfRenderTools: configuredTools.pdfRenderTools,
          mermaidTools: configuredTools.mermaidTools,
          drawioTools,
          maxInputPixels: getExtensionConfiguration().raster.maxInputPixels(),
          runId: `drawio-${fixtureCase.id}-png`,
        });
        await convertToSvgFiles({
          jobs: [{ sourcePath, outputPath: actualSvgPath, workspacePath }],
          mermaidTools: configuredTools.mermaidTools,
          drawioTools,
          runPdfToSvg: () => {
            throw new Error('drawio fixture must not include PDF input for SVG conversion');
          },
          maxInputPixels: getExtensionConfiguration().raster.maxInputPixels(),
          runId: `drawio-${fixtureCase.id}-svg`,
        });

        await (isEditableDrawioImagePath(sourcePath)
          ? convertToPdfFiles({
              jobs: [{ sourcePath, outputPath: actualPdfPath, workspacePath }],
              supportedExtensions: ['.drawio', '.drawio.png', '.drawio.svg'],
              tools: { drawioTools },
              maxInputPixels: getExtensionConfiguration().raster.maxInputPixels(),
              runtime,
              operationName: `drawio-${fixtureCase.id}-to-pdf`,
              runId: `drawio-${fixtureCase.id}-pdf`,
            })
          : convertDrawioToPdfFiles({
              jobs: [
                {
                  sourcePath,
                  outputTemplate: `\${workspaceFolder}/${fixtureCase.outputDirectory}/actual.pdf`,
                  workspacePath,
                  workspaceName: path.basename(workspacePath),
                },
              ],
              drawioPath,
              outputMode: 'single-pdf',
              runDrawio: executeDrawio,
              runtime,
              runId: `drawio-${fixtureCase.id}-native-pdf`,
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
    test(`invalid/drawio/${invalidCase.fileName}を実Draw.ioでPDFへ実変換すると失敗し、出力PDFを作成しない`, async function expectsInvalidFixtureToFailWithoutOutput() {
      const drawioPath = getExtensionConfiguration().execPath.drawio();
      if (drawioPath === '') {
        this.skip();
        return;
      }

      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'invalid', 'drawio', invalidCase.fileName);
        const sourcePath = await copyInputToWorkspace(inputPath, invalidCase.workspaceSourcePath);
        const conversion = convertDrawioToPdfFiles({
          jobs: [
            {
              sourcePath,
              outputTemplate: `\${workspaceFolder}/invalid-output-${index}.pdf`,
              workspacePath,
              workspaceName: path.basename(workspacePath),
            },
          ],
          drawioPath,
          outputMode: 'single-pdf',
          runDrawio: executeDrawio,
          runId: `drawio-invalid-${index}`,
        });

        await assert.rejects(conversion, invalidCase.fileName);
        await assert.rejects(access(path.join(workspacePath, `invalid-output-${index}.pdf`)));
      });
    });
  }
});

async function renderSvg(sourcePath: string, outputPath: string, rsvgConvertPath: string): Promise<void> {
  await execFileAsync(rsvgConvertPath, ['-o', outputPath, sourcePath]);
}
