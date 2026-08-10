// Test target:
// - 実Draw.io fixtureを複雑な入力pathへコピーしてPDF変換できること
// - Draw.io runnerへ入力pathと中間PDF出力pathをそのまま渡すこと
// - Draw.ioページ名、入力・出力のフォルダ名とファイル名に空白やUnicodeがあっても壊れないこと
// - 変換後PDFがfixtureと同じページ数・ページサイズで読み取れること
//
// Mocked:
// - Draw.io CLIの実行。CIにDraw.io Desktopを必須化せず、CLI境界へ渡すpathと出力の反映を検証する。

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';

import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import type { DrawioBackend } from '../../src/operations/conversion/tools/drawio_tools.js';
import { hashFile } from '../../src/operations/input/file_content_hash.js';
import { testInputDirectory } from '../helpers/fixture_paths.js';

const drawioFixturePath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

suite('空白とUnicodeを含むフォルダ名・ファイル名でのDraw.io画像のPDF変換', () => {
  test('空白とUnicodeを含むフォルダ名・ファイル名のfixtureを、入力pathと一時作業ディレクトリ内の中間PDF出力pathをそのままDraw.io実行関数へ渡して3ページPDFへ変換し、元fixtureファイルを変更しない', async () => {
    await using testRootPath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-complex-path-'));
    const workspacePath = path.join(
      testRootPath.path,
      'workspace 日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹　ＡＢＣ',
    );
    const inputDirectory = path.join(workspacePath, '入力 フォルダ　図面 العربية');
    const outputDirectory = path.join(workspacePath, '出力 フォルダ　結果 한국어');
    const sourcePath = path.join(inputDirectory, '　設計図 Drawio 日本語🌹　ＡＢＣ.dio.png');
    const outputPath = path.join(outputDirectory, '結果 ページ名　日本語🌹.pdf');

    await mkdir(inputDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await copyFile(drawioFixturePath, sourcePath);
    const originalSourceBytes = await readFile(sourcePath);
    const sourceText = originalSourceBytes.toString('utf8');
    assert.match(sourceText, /name=" ペ　ー　ジ 1"/u);
    assert.match(sourceText, /name=" p ーe2　"/u);
    assert.match(sourceText, /name=" {2}😀 ーe2　のco😀 py"/u);

    const drawioCalls: { executable: string; args: string[] }[] = [];
    const drawio: DrawioBackend = {
      drawioPath: 'drawio',
      runDrawio: async (executable, args) => {
        drawioCalls.push({ executable, args });
        const outputFlagIndex = args.indexOf('-o');
        assert.strictEqual(outputFlagIndex, 3);
        const toolOutputPath = args[outputFlagIndex + 1];
        assert.ok(toolOutputPath);
        assert.strictEqual(args[5], sourcePath);
        assert.ok(path.isAbsolute(toolOutputPath));
        assert.match(toolOutputPath, /workspace .*ＡＢＣ/u);
        await writeDrawioPdf(toolOutputPath, 3);
      },
    };

    const outputs = await convertToPdfFiles({
      maxInputPixels: 1_000_000_000,
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath,
        },
      ],
      tools: { drawioTools: drawio },
      runtime: { resolveConflicts: async () => 'overwrite' },
      runId: 'drawio-complex-path',
    });

    assert.deepStrictEqual(outputs, [
      {
        outputPath,
        workspacePath,
        sha256: await hashFile(outputPath),
        stagingRootPath: path.join(workspacePath, '.graphics-workbench', 'convert-to-pdf', 'drawio-complex-path'),
      },
    ]);
    assert.strictEqual(drawioCalls.length, 1);
    assert.strictEqual(drawioCalls[0]?.executable, 'drawio');
    assert.deepStrictEqual(drawioCalls[0]?.args.slice(0, 4), ['-x', '-f', 'pdf', '-o']);
    assert.strictEqual(drawioCalls[0]?.args[5], sourcePath);
    assert.deepStrictEqual(await readFile(sourcePath), originalSourceBytes);

    const actualPdf = await PDFDocument.load(await readFile(outputPath));
    const expectedPdf = await PDFDocument.load(await writeDrawioPdf(path.join(testRootPath.path, 'expected.pdf'), 3));
    assert.strictEqual(actualPdf.getPageCount(), 3);
    assert.strictEqual(actualPdf.getPageCount(), expectedPdf.getPageCount());
    assert.deepStrictEqual(
      actualPdf.getPages().map((page) => page.getSize()),
      expectedPdf.getPages().map((page) => page.getSize()),
    );
  });
});

async function writeDrawioPdf(filePath: string, pageCount: number): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) {
    document.addPage([200, 200]);
  }
  const bytes = await document.save();
  await writeFile(filePath, bytes);
  return bytes;
}
