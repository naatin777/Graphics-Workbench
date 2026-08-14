// Test target:
// - 実Draw.io テストデータを複雑な入力pathへコピーしてPDF変換できること
// - Draw.io runnerへ入力pathと中間PDF出力pathをそのまま渡すこと
// - Draw.ioページ名、入力・出力のフォルダ名とファイル名に空白やUnicodeがあっても壊れないこと
// - 変換後PDFがテストデータと同じページ数・ページサイズで読み取れること
//
// Mocked:
// - Draw.io CLIの実行。CIにDraw.io Desktopを必須化せず、CLI境界へ渡すpathと出力の反映を検証する。

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { testInputDirectory, readPdfPages, createPdfTestData } from '@graphics-workbench/core/testing';
import { Result } from 'better-result';

import { convertToPdfFiles, type DrawioBackend } from '@graphics-workbench/core/conversion';
import { hashFile } from '@graphics-workbench/core/runtime';

const drawioTestDataPath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

describe('空白とUnicodeを含むフォルダ名・ファイル名でのDraw.io画像のPDF変換', () => {
  it('空白とUnicodeを含むフォルダ名・ファイル名のテストデータを、入力pathと一時作業ディレクトリ内の中間PDF出力pathをそのままDraw.io実行関数へ渡して3ページPDFへ変換し、元テストデータファイルを変更しない', async () => {
    await using testRootPathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-complex-path-'));
    const testRootPath = testRootPathDisposable.path;
    const workspacePath = path.join(
      testRootPath,
      'workspace 日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹　ＡＢＣ',
    );
    const inputDirectory = path.join(workspacePath, '入力 フォルダ　図面 العربية');
    const outputDirectory = path.join(workspacePath, '出力 フォルダ　結果 한국어');
    const sourcePath = path.join(inputDirectory, '　設計図 Drawio 日本語🌹　ＡＢＣ.dio.png');
    const outputPath = path.join(outputDirectory, '結果 ページ名　日本語🌹.pdf');

    await mkdir(inputDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await copyFile(drawioTestDataPath, sourcePath);
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
        return Result.ok();
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

    const actualPages = await readPdfPages(await readFile(outputPath));
    const expectedPages = await readPdfPages(await writeDrawioPdf(path.join(testRootPath, 'expected.pdf'), 3));
    assert.strictEqual(actualPages.length, 3);
    assert.strictEqual(actualPages.length, expectedPages.length);
    assert.deepStrictEqual(
      actualPages.map((page) => page.mediaBox),
      expectedPages.map((page) => page.mediaBox),
    );
  });
});

async function writeDrawioPdf(filePath: string, pageCount: number): Promise<Uint8Array> {
  const bytes = await createPdfTestData({
    pages: Array.from({ length: pageCount }, () => ({ mediaBox: [0, 0, 200, 200] })),
  });
  await writeFile(filePath, bytes);
  return bytes;
}
