import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { convertDrawioToPdfFiles } from '../../src/operations/conversion/convert_drawio_to_pdf.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { requireValue } from '../helpers/required.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

const drawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');
const emptyDrawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'empty.drawio');

suite('Draw.io PDF変換', () => {
  test('ネイティブDraw.ioをページ名ごとのPDFへ分割する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'q a.drawio');
    await copyFile(drawioFixturePath, sourcePath);
    const originalSource = await readFile(sourcePath, 'utf8');
    const calls: string[][] = [];

    const outputs = await convertDrawioToPdfFiles({
      jobs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      outputMode: 'page-pdfs',
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
    assert.strictEqual(
      await PDFDocument.load(await readFile(requireValue(outputs[0]).outputPath)).then((pdf) => pdf.getPageCount()),
      1,
    );
    assert.strictEqual(
      await PDFDocument.load(await readFile(requireValue(outputs[1]).outputPath)).then((pdf) => pdf.getPageCount()),
      1,
    );
    assert.strictEqual(await readFile(sourcePath, 'utf8'), originalSource);
  });

  test('ネイティブDraw.ioの全ページを1つのPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-direct-'));

    const sourcePath = path.join(workspacePath.path, 'q a.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioFixturePath, sourcePath);

    const outputs = await convertDrawioToPdfFiles({
      jobs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/all-pages.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      outputMode: 'single-pdf',
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
    assert.strictEqual(await PDFDocument.load(await readFile(outputPath)).then((pdf) => pdf.getPageCount()), 3);
  });

  test('ページ名をWindowsで安全かつ一意な出力名へ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-names-'));

    const sourcePath = path.join(workspacePath.path, 'names.drawio');
    await writeFile(
      sourcePath,
      '<mxfile><diagram name="CON"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram name="con"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>',
    );

    const outputs = await convertDrawioToPdfFiles({
      jobs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/${page}.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath: 'drawio',
      outputMode: 'page-pdfs',
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

  test('設定されたDraw.io CLIを実際に起動して全ページを1つのPDFへ変換する', async function realDrawioCliConversion() {
    const { drawioTools } = readConfiguredConversionTools();
    const { drawioPath } = drawioTools;
    if (drawioPath === '') {
      this.skip();
      return;
    }

    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-real-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio');
    const outputPath = path.join(workspacePath.path, 'all-pages.pdf');
    await copyFile(drawioFixturePath, sourcePath);

    const outputs = await convertDrawioToPdfFiles({
      jobs: [
        {
          sourcePath,
          outputTemplate: '${fileDirname}/all-pages.pdf',
          workspacePath: workspacePath.path,
          workspaceName: path.basename(workspacePath.path),
        },
      ],
      drawioPath,
      outputMode: 'single-pdf',
      runId: 'real-cli-test',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.deepStrictEqual(
      outputs.map(({ outputPath: actualPath }) => actualPath),
      [outputPath],
    );
    assert.strictEqual(await PDFDocument.load(await readFile(outputPath)).then((pdf) => pdf.getPageCount()), 3);
  });

  test('コンテンツのないDraw.ioファイルはCLIを起動せず明示的なエラーにする', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-pdf-empty-'));

    const sourcePath = path.join(workspacePath.path, 'empty.drawio');
    await copyFile(emptyDrawioFixturePath, sourcePath);
    let cliCalled = false;

    await assert.rejects(
      convertDrawioToPdfFiles({
        jobs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/empty.pdf',
            workspacePath: workspacePath.path,
            workspaceName: path.basename(workspacePath.path),
          },
        ],
        drawioPath: 'drawio',
        outputMode: 'single-pdf',
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
  const document = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) {
    document.addPage([200, 200]);
  }
  await writeFile(filePath, await document.save());
}
