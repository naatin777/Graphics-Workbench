import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { convertDrawioToPdfFiles } from '../../src/operations/conversion/convert_drawio_to_pdf.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { requireValue } from '../helpers/required.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

const drawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

suite('Draw.io PDF変換', () => {
  test('ネイティブDraw.ioをページ名ごとのPDFへ分割する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-drawio-pdf-'));

    try {
      const sourcePath = path.join(workspacePath, 'q a.drawio');
      await copyFile(drawioFixturePath, sourcePath);
      const originalSource = await readFile(sourcePath, 'utf8');
      const calls: string[][] = [];

      const outputs = await convertDrawioToPdfFiles({
        jobs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/${fileBasenameNoExtension}/${page}.pdf',
            workspacePath,
            workspaceName: path.basename(workspacePath),
          },
        ],
        drawioPath: 'drawio',
        outputMode: 'page-pdfs',
        runId: 'split-test',
        runtime: { resolveConflicts: async () => 'overwrite' },
        runDrawio: async (_executable, args) => {
          calls.push(args);
          assert.notStrictEqual(args[0], sourcePath);
          await writeFile(requireValue(args[0]), `${originalSource}\n<!-- mutated staged source -->`);
          await writePdfPages(requireValue(args[args.indexOf('-o') + 1]), 3);
        },
      });

      assert.deepStrictEqual(
        outputs.map(({ outputPath }) => outputPath),
        [
          path.join(workspacePath, 'q a', 'ペ　ー　ジ 1.pdf'),
          path.join(workspacePath, 'q a', 'p ーe2.pdf'),
          path.join(workspacePath, 'q a', '😀 ーe2　のco😀 py.pdf'),
        ],
      );
      assert.deepStrictEqual(calls[0], [
        path.join(
          workspacePath,
          '.graphics-workbench',
          'convert-drawio-to-pdf',
          'split-test',
          '1-q_a',
          'source.drawio',
        ),
        '-o',
        path.join(
          workspacePath,
          '.graphics-workbench',
          'convert-drawio-to-pdf',
          'split-test',
          '1-q_a',
          'all-pages.pdf',
        ),
        '-x',
        '-f',
        'pdf',
        '-t',
        '-a',
        '--crop',
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('ネイティブDraw.ioの全ページを1つのPDFへ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-drawio-pdf-direct-'));

    try {
      const sourcePath = path.join(workspacePath, 'q a.drawio');
      const outputPath = path.join(workspacePath, 'all-pages.pdf');
      await copyFile(drawioFixturePath, sourcePath);

      const outputs = await convertDrawioToPdfFiles({
        jobs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/all-pages.pdf',
            workspacePath,
            workspaceName: path.basename(workspacePath),
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('ページ名をWindowsで安全かつ一意な出力名へ変換する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-drawio-pdf-names-'));

    try {
      const sourcePath = path.join(workspacePath, 'names.drawio');
      await writeFile(sourcePath, '<mxfile><diagram name="CON"/><diagram name="con"/></mxfile>');

      const outputs = await convertDrawioToPdfFiles({
        jobs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/${page}.pdf',
            workspacePath,
            workspaceName: path.basename(workspacePath),
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
        [path.join(workspacePath, '_CON.pdf'), path.join(workspacePath, '_con-2.pdf')],
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('設定されたDraw.io CLIを実際に起動して全ページを1つのPDFへ変換する', async function realDrawioCliConversion() {
    const { drawioTools } = readConfiguredConversionTools();
    const { drawioPath } = drawioTools;
    if (drawioPath === '') {
      this.skip();
      return;
    }

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-drawio-pdf-real-'));

    try {
      const sourcePath = path.join(workspacePath, 'source.drawio');
      const outputPath = path.join(workspacePath, 'all-pages.pdf');
      await copyFile(drawioFixturePath, sourcePath);

      const outputs = await convertDrawioToPdfFiles({
        jobs: [
          {
            sourcePath,
            outputTemplate: '${fileDirname}/all-pages.pdf',
            workspacePath,
            workspaceName: path.basename(workspacePath),
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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

async function writePdfPages(filePath: string, pageCount: number): Promise<void> {
  const document = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) {
    document.addPage([200, 200]);
  }
  await writeFile(filePath, await document.save());
}
