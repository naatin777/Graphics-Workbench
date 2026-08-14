import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isDrawioImagePath } from '@graphics-workbench/core/formats';
import {
  convertSinglePng,
  convertSinglePdf,
  convertSingleSvg,
  convertSplitPdf,
} from '@graphics-workbench/core/conversion';
import {
  assertPdfMatches,
  assertRasterMatches,
  copyInputToWorkspace,
  readConfiguredConversionConfiguration,
  testInputDirectory,
  testOutputDirectory,
  withTestWorkspace,
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
      const configuration = readConfiguredConversionConfiguration();

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
        const source = { sourcePath, workspacePath, workspaceName: path.basename(workspacePath) };

        const pngResult = await convertSinglePng([source], '${fileDirname}/actual.png', configuration, {});
        if (pngResult.isErr()) {
          throw pngResult.error;
        }
        const svgResult = await convertSingleSvg([source], '${fileDirname}/actual.svg', configuration, {});
        if (svgResult.isErr()) {
          throw svgResult.error;
        }

        const pdfResult = await (isDrawioImagePath(sourcePath)
          ? convertSinglePdf([source], '${fileDirname}/actual.pdf', configuration, {})
          : convertSplitPdf(
              [source],
              `\${workspaceFolder}/${testDataCase.outputDirectory}/actual.pdf`,
              configuration,
              {},
            ));
        if (pdfResult.isErr()) {
          throw pdfResult.error;
        }

        await assertRasterMatches(actualPngPath, path.join(expectedDirectory, 'expected.png'), `PNG: ${sourcePath}`, {
          rendererVariance: true,
        });

        const rsvgConvertPath = configuration.svgToPdf?.rsvgConvertPath ?? '';
        await renderSvg(actualSvgPath, renderedActualSvgPath, rsvgConvertPath);
        await renderSvg(path.join(expectedDirectory, 'expected.svg'), renderedExpectedSvgPath, rsvgConvertPath);
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
      const configuration = readConfiguredConversionConfiguration();

      await withTestWorkspace(async (workspacePath) => {
        const inputPath = path.join(testInputDirectory, 'invalid', 'drawio', invalidCase.fileName);
        const sourcePath = await copyInputToWorkspace(inputPath, workspacePath, invalidCase.workspaceSourcePath);
        const source = { sourcePath, workspacePath, workspaceName: path.basename(workspacePath) };

        const result = await convertSplitPdf(
          [source],
          `\${workspaceFolder}/invalid-output-${index}.pdf`,
          configuration,
          {},
        );

        assert.ok(result.isErr(), `expected failure for ${invalidCase.fileName}`);
        await assert.rejects(access(path.join(workspacePath, `invalid-output-${index}.pdf`)));
      });
    });
  }
});

async function renderSvg(sourcePath: string, outputPath: string, rsvgConvertPath: string): Promise<void> {
  await execFileAsync(rsvgConvertPath, ['-o', outputPath, sourcePath]);
}
