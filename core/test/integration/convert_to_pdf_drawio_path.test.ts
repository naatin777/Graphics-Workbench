// Test target:
// - 実Draw.io テストデータを複雑な入力pathへコピーしてPDF変換すること
// - Draw.ioページ名、入力・出力のフォルダ名とファイル名に空白やUnicodeがあっても壊れないこと
// - 変換前の入力検証で失敗した場合は出力を作らず、元ファイルを変更しないこと
//
// Mocked:
// - なし（Draw.io backendを設定しない失敗behaviorを検証する。実CLIの成功経路はexternalで確認する）

import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { testInputDirectory, testConversionConfiguration } from '@graphics-workbench/core/testing';

import { convertSinglePdf } from '@graphics-workbench/core/conversion';

const drawioTestDataPath = path.join(testInputDirectory, 'valid', 'drawio', 'unicode-page-names.drawio');

describe('空白とUnicodeを含むフォルダ名・ファイル名でのDraw.io画像のPDF変換', () => {
  it('Draw.io backend未設定のeditable Draw.io画像は、空白とUnicodeを含む複雑なpathでもエラーのResultを返し、出力PDFを作成せず元テストデータファイルを変更しない', async () => {
    await using testRootPathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-drawio-complex-path-'));
    const testRootPath = testRootPathDisposable.path;
    const workspacePath = path.join(
      testRootPath,
      'workspace 日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹　ＡＢＣ',
    );
    const inputDirectory = path.join(workspacePath, '入力 フォルダ　図面 العربية');
    const sourcePath = path.join(inputDirectory, '　設計図 Drawio 日本語🌹　ＡＢＣ.dio.png');

    await mkdir(inputDirectory, { recursive: true });
    await copyFile(drawioTestDataPath, sourcePath);
    const originalSourceBytes = await readFile(sourcePath);
    const sourceText = originalSourceBytes.toString('utf8');
    assert.match(sourceText, /name=" ペ　ー　ジ 1"/u);
    assert.match(sourceText, /name=" p ーe2　"/u);
    assert.match(sourceText, /name=" {2}😀 ーe2　のco😀 py"/u);

    const result = await convertSinglePdf(
      [{ sourcePath, workspacePath, workspaceName: path.basename(workspacePath) }],
      '${fileDirname}/結果 ページ名　日本語🌹.pdf',
      testConversionConfiguration({ maxInputPixels: 1_000_000_000, drawioPath: '' }),
      {},
    );
    assert.ok(result.isErr(), 'Draw.io backend must be required for editable Draw.io images');
    assert.match(result.error.message, /Draw\.io executable is not configured/u);
    assert.deepStrictEqual(await readFile(sourcePath), originalSourceBytes);
    await assert.rejects(readFile(path.join(inputDirectory, '結果 ページ名　日本語🌹.pdf')));
  });
});
