import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { requireValue, testInputDirectory, createPdfFixture, readPdfPages } from '@graphics-workbench/core/testing';

import { convertDrawioToPagePdfs, convertDrawioToSinglePdf, executeDrawio } from '@graphics-workbench/core/conversion';

const drawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');
const emptyDrawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'empty.drawio');

describe('Draw.ioファイルをDraw.io CLI経由でPDFへ変換する', () => {
  it('drawioファイルを一時作業ディレクトリへ複製してpage-pdfsモードでDraw.io CLIを実行し、ページ名ごとのPDF（各1ページ）を生成して元ファイルは変更しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'q a.drawio');
    await copyFile(drawioFixturePath, sourcePath);
    const originalSource = await readFile(sourcePath, 'utf8');
    const calls: string[][] = [];

    const outputs = await convertDrawioToPagePdfs({
      inputs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      runId: 'split-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
      runDrawio: async (_executable, args) => {
        calls.push(args);
        const stagedSourcePath = requireValue(args.at(-1));
        assert.notStrictEqual(stagedSourcePath, sourcePath);
        await writeFile(stagedSourcePath, `${originalSource}\n<!-- mutated staged source -->`);
        await writePdfPages(requireValue(args[args.indexOf('-o') + 1]), 3);
      },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath }) => outputPath),
      [
        path.join(workspacePath.path, 'q a', 'ペ　ー　ジ 1.pdf'),
        path.join(workspacePath.path, 'q a', 'p ーe2.pdf'),
        path.join(workspacePath.path, 'q a', '😀 ーe2　のco😀 py.pdf'),
      ],
    );
    assert.deepStrictEqual(calls[0], [
      '-x',
      '-f',
      'pdf',
      '-o',
      path.join(
        workspacePath.path,
        '.graphics-workbench',
        'convert-drawio-to-pdf',
        'split-test',
        '1-q_a',
        'all-pages.pdf',
      ),
      '-t',
      '-a',
      '--crop',
      path.join(
        workspacePath.path,
        '.graphics-workbench',
        'convert-drawio-to-pdf',
        'split-test',
        '1-q_a',
        'source.drawio',
      ),
    ]);
    assert.strictEqual((await readPdfPages(await readFile(requireValue(outputs[0]).outputPath))).length, 1);
    assert.strictEqual((await readPdfPages(await readFile(requireValue(outputs[1]).outputPath))).length, 1);
    assert.strictEqual(await readFile(sourcePath, 'utf8'), originalSource);
  });

  it('single-pdfモードで全ページを1つのPDFへ変換し、3ページのall-pages.pdfを出力する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-direct-'));

    const sourcePath = path.join(workspacePath.path, 'q a.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioFixturePath, sourcePath);

    const outputs = await convertDrawioToSinglePdf({
      inputs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/all-pages.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      runId: 'direct-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
      runDrawio: async (_executable, args) => {
        await writePdfPages(requireValue(args[args.indexOf('-o') + 1]), 3);
      },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath: actualPath }) => actualPath),
      [outputPath],
    );
    assert.strictEqual((await readPdfPages(await readFile(outputPath))).length, 3);
  });

  it('ページ名CONとconが並ぶ場合、Windows予約名・重複を避けて一意な出力名（_CON.pdfと_con-2.pdf）へ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-names-'));

    const sourcePath = path.join(workspacePath.path, 'names.drawio');
    await writeFile(
      sourcePath,
      '<mxfile><diagram name="CON"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram name="con"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>',
    );

    const outputs = await convertDrawioToPagePdfs({
      inputs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/${page}.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      runId: 'names-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
      runDrawio: async (_executable, args) => {
        await writePdfPages(requireValue(args[args.indexOf('-o') + 1]), 2);
      },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath }) => outputPath),
      [path.join(workspacePath.path, '_CON.pdf'), path.join(workspacePath.path, '_con-2.pdf')],
    );
  });

  it('設定されたDraw.io CLIを実際に起動し、全ページを3ページの1つのPDFへ変換する（設定が空ならskipする）', async (ctx) => {
    const drawioPath = process.env.GRAPHICS_WORKBENCH_DRAWIO_PATH ?? '';
    if (drawioPath === '') {
      ctx.skip();
      return;
    }

    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioFixturePath, sourcePath);

    const outputs = await convertDrawioToSinglePdf({
      inputs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/all-pages.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath,
      runDrawio: executeDrawio,
      runId: 'real-cli-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath: actualPath }) => actualPath),
      [outputPath],
    );
    assert.strictEqual((await readPdfPages(await readFile(outputPath))).length, 3);
  });

  it('コンテンツのないDraw.ioファイルはCLIを起動せず「no content to export」エラーを返し、出力PDFも作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-empty-'));

    const sourcePath = path.join(workspacePath.path, 'empty.drawio');
    await copyFile(emptyDrawioFixturePath, sourcePath);
    let cliCalled = false;

    await assert.rejects(
      convertDrawioToSinglePdf({
        inputs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/empty.pdf',
            workspacePath: workspacePath.path,
            workspaceName: path.basename(workspacePath.path),
          },
        ],
        drawioPath: 'drawio',
        runId: 'empty-test',
        runtime: { resolveConflicts: async () => 'overwrite' },
        runDrawio: async () => {
          cliCalled = true;
        },
      }),
      /no content to export/u,
    );

    assert.strictEqual(cliCalled, false);
    assert.strictEqual(existsSync(path.join(workspacePath.path, 'empty.pdf')), false);
  });
});

async function writePdfPages(filePath: string, pageCount: number): Promise<void> {
  const bytes = await createPdfFixture({
    pages: Array.from({ length: pageCount }, () => ({ mediaBox: [0, 0, 200, 200] })),
  });
  await writeFile(filePath, bytes);
}
