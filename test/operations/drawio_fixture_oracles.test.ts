import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isEditableDrawioImagePath } from '../../src/application/policy/source_format.js';
import { readDrawioExecutablePath } from '../../src/config/external_tools/external_tool_paths.js';
import { convertDrawioToPdfFiles } from '../../src/operations/conversion/convert_drawio_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
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

suite('Draw.io fixtureの実変換比較', () => {
  for (const fixtureCase of validCases) {
    test(`${fixtureCase.inputFileName}をPNG/SVG/PDFへ変換すると固定正解データと一致する`, async function convertsFixtureToExpectedOutputs() {
      const drawioPath = readDrawioExecutablePath(getExtensionConfiguration());
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

        const drawioTools = { drawioPath };
        await executePngConversion({
          jobs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          runtime,
          pdftocairoTools: configuredTools.pdftocairoTools,
          ghostscriptTools: configuredTools.ghostscriptTools,
          mermaidTools: configuredTools.mermaidTools,
          drawioTools,
          runId: `drawio-${fixtureCase.id}-png`,
        });
        await convertToSvgFiles({
          jobs: [{ sourcePath, outputPath: actualSvgPath, workspacePath }],
          pdftocairoTools: configuredTools.pdftocairoTools,
          ghostscriptTools: configuredTools.ghostscriptTools,
          mermaidTools: configuredTools.mermaidTools,
          drawioTools,
          runId: `drawio-${fixtureCase.id}-svg`,
        });

        await (isEditableDrawioImagePath(sourcePath)
          ? convertToPdfFiles({
              jobs: [{ sourcePath, outputPath: actualPdfPath, workspacePath }],
              supportedExtensions: ['.drawio', '.drawio.png', '.drawio.svg'],
              tools: { drawioTools },
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
              runtime,
              runId: `drawio-${fixtureCase.id}-native-pdf`,
            }));

        await assertRasterMatches(actualPngPath, path.join(expectedDirectory, 'expected.png'), `PNG: ${sourcePath}`);

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
    test(`invalid/drawio/${invalidCase.fileName}をPDFへ実変換すると失敗し、出力を残さない`, async function expectsInvalidFixtureToFailWithoutOutput() {
      const drawioPath = readDrawioExecutablePath(getExtensionConfiguration());
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
