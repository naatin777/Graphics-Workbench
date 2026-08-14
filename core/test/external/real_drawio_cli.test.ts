import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { convertSinglePdf, convertSplitPdf, type ConversionConfiguration } from '@graphics-workbench/core/conversion';
import {
  readPdfPages,
  requireConfiguredTool,
  testConversionConfiguration,
  testInputDirectory,
} from '@graphics-workbench/core/testing';

const drawioTestDataPath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

function configuredDrawio(): ConversionConfiguration {
  return testConversionConfiguration({
    maxInputPixels: 1_000_000_000,
    drawioPath: requireConfiguredTool('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'Draw.io'),
  });
}

describe('実Draw.io CLIによる全ページPDF変換', () => {
  it('設定されたDraw.io CLIを実際に起動し、全ページを3ページの1つのPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioTestDataPath, sourcePath);

    const result = await convertSinglePdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/all-pages.pdf',
      configuredDrawio(),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    assert.deepStrictEqual(
      result.value.map(({ outputPath: committedPath }) => committedPath),
      [outputPath],
    );
    assert.strictEqual((await readPdfPages(await readFile(outputPath))).length, 3);
  });

  it('Draw.ioページ名（空白・Unicode）をそのままページ名として各1ページのPDFへ分割する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-split-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    await copyFile(drawioTestDataPath, sourcePath);

    const result = await convertSplitPdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf',
      configuredDrawio(),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    assert.deepStrictEqual(
      result.value.map(({ outputPath }) => outputPath),
      [
        path.join(workspacePath.path, 'source', 'ペ　ー　ジ 1.pdf'),
        path.join(workspacePath.path, 'source', 'p ーe2.pdf'),
        path.join(workspacePath.path, 'source', '😀 ーe2　のco😀 py.pdf'),
      ],
    );
    for (const { outputPath } of result.value) {
      assert.strictEqual((await readPdfPages(await readFile(outputPath))).length, 1);
    }
  });

  it('ページ名CONとconが並ぶ場合、Windows予約名・重複を避けて一意な出力名（_CON.pdfと_con-2.pdf）へ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-names-real-'));

    const sourcePath = path.join(workspacePath.path, 'names.drawio');
    await writeFile(
      sourcePath,
      '<mxfile><diagram name="CON"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram name="con"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>',
    );

    const result = await convertSplitPdf(
      [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      '${fileDirname}/${page}.pdf',
      configuredDrawio(),
      {},
    );
    if (result.isErr()) {
      throw result.error;
    }

    assert.deepStrictEqual(
      result.value.map(({ outputPath }) => outputPath),
      [path.join(workspacePath.path, '_CON.pdf'), path.join(workspacePath.path, '_con-2.pdf')],
    );
  });
});
