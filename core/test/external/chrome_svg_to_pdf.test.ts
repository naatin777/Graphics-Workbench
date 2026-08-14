import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { convertSinglePdf } from '@graphics-workbench/core/conversion';
import { renderPdfPageToPng } from '@graphics-workbench/core/pdf';
import {
  readPdfPages,
  requireConfiguredTool,
  testConversionConfiguration,
  testInputDirectory,
} from '@graphics-workbench/core/testing';

describe('実ChromeによるSVG→PDF印刷', () => {
  it('31x19 SVGいっぱいの矩形をPDFへ印刷すると、ページ全体に内容が残る', async () => {
    const chromePath = requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_CHROME_PATH', 'Chrome');

    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-chrome-content-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await copyFile(path.join(testInputDirectory, 'valid', 'svg', 'solid-rect-31x19.svg'), sourcePath);

    const result = await convertSinglePdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/output.pdf',
      testConversionConfiguration({
        maxInputPixels: 1_000_000_000,
        svgToPdf: {
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath,
        },
      }),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    const pdfPages = await readPdfPages(await readFile(outputPath));
    assert.deepStrictEqual(
      { width: pdfPages[0]?.mediaBox.width, height: pdfPages[0]?.mediaBox.height },
      { width: 31, height: 19 },
    );
    const rendered = await renderPdfPageToPng(await readFile(outputPath), 1, { dpi: 72 });
    const { data, info } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if ((data[index] ?? 0) > 150 && (data[index + 1] ?? 0) < 120 && (data[index + 2] ?? 0) < 120) {
        redPixels += 1;
      }
    }
    assert.ok(
      redPixels / (info.width * info.height) > 0.9,
      'Chrome PDF content was clipped or left at the default print scale.',
    );
  });
});
