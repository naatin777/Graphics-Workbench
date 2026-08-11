import assert from 'node:assert/strict';
import path from 'node:path';

import { logicalSourcePathForOutputTemplate } from '../../src/shared/source_format.js';
import { resolveOutputPath, type OutputPathContext } from '../../src/config/output/resolve_output_path.js';

type OutputPathPlatform = 'win32' | 'posix';
type ResolveOutputPathWithPlatform = (
  templatePath: string,
  context: OutputPathContext,
  options: { platform: OutputPathPlatform; allowedExtensions?: readonly string[] },
) => string;

// Implementation Phaseで追加するplatform注入契約を、失敗テスト段階でも型安全に呼び出す。
const resolveOutputPathWithPlatform = resolveOutputPath as ResolveOutputPathWithPlatform;

suite('出力パスのテンプレート解決', () => {
  test("元PDFパスから${fileDirname}・${fileBasenameNoExtension}・${fileExtname}を展開し、workspace/figures配下に'sample-crop.pdf'の出力パスを生成する", () => {
    const workspacePath = path.resolve(path.sep, 'workspace');
    const sourcePath = path.join(workspacePath, 'figures', 'sample.pdf');

    const result = resolveOutputPath('${fileDirname}/${fileBasenameNoExtension}-crop${fileExtname}', {
      workspacePath,
      workspaceName: 'workspace',
      sourcePath,
      dateNow: 123,
    });

    assert.strictEqual(result, path.join(workspacePath, 'figures', 'sample-crop.pdf'));
  });

  test("相対テンプレート'generated/${relativeFileDirname}/${fileBasename}'をworkspaceパス基準の絶対パス'workspace/generated/figures/sample.pdf'へ解決する", () => {
    const workspacePath = path.resolve(path.sep, 'workspace');
    const sourcePath = path.join(workspacePath, 'figures', 'sample.pdf');

    const result = resolveOutputPath('generated/${relativeFileDirname}/${fileBasename}', {
      workspacePath,
      workspaceName: 'workspace',
      sourcePath,
    });

    assert.strictEqual(result, path.join(workspacePath, 'generated', 'figures', 'sample.pdf'));
  });

  test("ソースファイル名に含まれる'${fileExtname}'リテラルを基底名として展開した結果に現れるテンプレート構文を再展開せず、そのままの文字列として出力パスに残す", () => {
    const workspacePath = path.resolve(path.sep, 'workspace');
    const sourcePath = path.join(workspacePath, 'figures', '${fileExtname}.pdf');

    const result = resolveOutputPath('${fileBasenameNoExtension}-crop${fileExtname}', {
      workspacePath,
      workspaceName: 'workspace',
      sourcePath,
    });

    assert.strictEqual(result, path.join(workspacePath, '${fileExtname}-crop.pdf'));
  });

  test("未対応のテンプレート変数${unknown}を含む場合は、パス解決を開始せず'Unsupported output path variable'の例外を投げる", () => {
    const workspacePath = path.resolve(path.sep, 'workspace');

    assert.throws(
      () =>
        resolveOutputPath('${unknown}/result.pdf', {
          workspacePath,
          workspaceName: 'workspace',
          sourcePath: path.join(workspacePath, 'sample.pdf'),
        }),
      /Unsupported output path variable/,
    );
  });

  test('${random}を16進数8桁のランダム文字列へ展開し、workspaceFolder基準の結合PDFパスを生成する', () => {
    const workspacePath = path.resolve(path.sep, 'workspace');

    const result = resolveOutputPath('${workspaceFolder}/combined-${random}.pdf', {
      workspacePath,
      workspaceName: 'workspace',
      sourcePath: path.join(workspacePath, 'first.png'),
    });

    const directory = path.dirname(result);
    const basename = path.basename(result, '.pdf');
    assert.strictEqual(directory, workspacePath);
    assert.match(basename, /^combined-[0-9a-f]{8}$/u);
  });

  test('context.randomを指定すると${random}をその値へ展開する', () => {
    const workspacePath = path.resolve(path.sep, 'workspace');

    const result = resolveOutputPath('${workspaceFolder}/combined-${random}.pdf', {
      workspacePath,
      workspaceName: 'workspace',
      sourcePath: path.join(workspacePath, 'first.png'),
      random: 'a83f2c91',
    });

    assert.strictEqual(result, path.join(workspacePath, 'combined-a83f2c91.pdf'));
  });

  test("Windowsでpath componentに予約文字(< > : \" | ? *)のいずれかを含む場合は、'reserved character'エラーで拒否する", () => {
    for (const character of ['<', '>', ':', '"', '|', '?', '*']) {
      assert.throws(
        () =>
          resolveOutputPathWithPlatform(`output/result${character}.pdf`, windowsContext(), {
            platform: 'win32',
          }),
        /Invalid output path for Windows:.*reserved character/,
      );
    }
  });

  test("WindowsでパスにNUL文字または制御文字(U+0001〜U+001F)を含む場合は、'control character|NUL'エラーで拒否する", () => {
    for (const character of ['\u0000', '\u0001', '\u001f']) {
      assert.throws(
        () =>
          resolveOutputPathWithPlatform(`output/result${character}.pdf`, windowsContext(), {
            platform: 'win32',
          }),
        /Invalid output path for Windows:.*control character|NUL/,
      );
    }
  });

  test("WindowsでCON・NUL・COM1・LPT9等の予約デバイス名を、拡張子付き・大文字小文字違い・¹³などの数字置換を含む形でも'reserved name'エラーで拒否する", () => {
    for (const fileName of ['CON', 'con.pdf', 'NUL.tar.gz', 'COM1.pdf', 'com¹.log', 'LPT9.pdf', 'lpt³.txt']) {
      assert.throws(
        () =>
          resolveOutputPathWithPlatform(`output/${fileName}`, windowsContext(), {
            platform: 'win32',
          }),
        /Invalid output path for Windows:.*reserved name/,
      );
    }
  });

  test("Windowsでpath componentの先頭半角空白・末尾半角空白・末尾ピリオドを含む場合は、それぞれ'leading ASCII space'等の理由で拒否する", () => {
    const cases = [
      { template: 'output/ result.pdf', reason: /leading ASCII space/ },
      { template: 'output/result.pdf ', reason: /trailing ASCII space/ },
      { template: 'output/result.pdf.', reason: /trailing period/ },
      { template: 'output/folder /result.pdf', reason: /trailing ASCII space/ },
    ];

    for (const { template, reason } of cases) {
      assert.throws(
        () =>
          resolveOutputPathWithPlatform(template, windowsContext(), {
            platform: 'win32',
          }),
        reason,
      );
    }
  });

  test("Windowsで'${workspaceFolder}\\output\\result.pdf'を解決し、drive letterとバックスラッシュ区切りの絶対パス'C:\\workspace\\output\\result.pdf'を返す", () => {
    const result = resolveOutputPathWithPlatform('${workspaceFolder}\\output\\result.pdf', windowsContext(), {
      platform: 'win32',
    });

    assert.strictEqual(result, 'C:\\workspace\\output\\result.pdf');
  });

  test('Windowsで多言語・絵文字・全角文字・全角空白を含むファイル名を一切変更せず、そのままの文字列で出力パスを返す', () => {
    const fileName = '　日本語 English 한국어 中文 العربية हिन्दी ไทย עברית Ελληνικά Русский 🌹 ＡＢＣ１２３①.pdf';
    // Intentional literal ${} syntax.
    const result = resolveOutputPathWithPlatform(`\${workspaceFolder}\\output\\${fileName}`, windowsContext(), {
      platform: 'win32',
    });

    assert.strictEqual(result, `C:\\workspace\\output\\${fileName}`);
  });

  test("POSIXではWindows専用の禁止文字と予約名'CON?:*'を含むパスをそのまま許可し、スラッシュ区切りの絶対パスで返す", () => {
    const result = resolveOutputPathWithPlatform('${workspaceFolder}/output/CON?:*.pdf', posixContext(), {
      platform: 'posix',
    });

    assert.strictEqual(result, '/workspace/output/CON?:*.pdf');
  });

  test("POSIXでもパスにNUL文字を含む場合は、'Invalid output path for POSIX:.*NUL'エラーで拒否する", () => {
    assert.throws(
      () =>
        resolveOutputPathWithPlatform('output/result\u0000.pdf', posixContext(), {
          platform: 'posix',
        }),
      /Invalid output path for POSIX:.*NUL/,
    );
  });

  test('許容拡張子として.pngのみ指定された場合、.pdfの出力は拡張子エラーで拒否し、大文字の.PNGは許可する', () => {
    assert.throws(
      () => resolveOutputPath('output/result.pdf', posixContext(), { allowedExtensions: ['.png'] }),
      /Invalid output extension.*\.pdf/,
    );
    assert.doesNotThrow(() => resolveOutputPath('output/result.PNG', posixContext(), { allowedExtensions: ['.png'] }));
  });

  test("Draw.io compoundソース名'diagram.drawio.png'を論理名'diagram'として展開し、出力テンプレートを'/workspace/figures/diagram.png'へ解決する", () => {
    const result = resolveOutputPathWithPlatform(
      '${fileDirname}/${fileBasenameNoExtension}.png',
      {
        ...posixContext(),
        sourcePath: logicalSourcePathForOutputTemplate('/workspace/figures/diagram.drawio.png'),
      },
      { platform: 'posix', allowedExtensions: ['.png'] },
    );

    assert.strictEqual(result, '/workspace/figures/diagram.png');
  });
});

function windowsContext(): OutputPathContext {
  return {
    workspacePath: 'C:\\workspace',
    workspaceName: 'workspace',
    sourcePath: 'C:\\workspace\\figures\\source.pdf',
  };
}

function posixContext(): OutputPathContext {
  return {
    workspacePath: '/workspace',
    workspaceName: 'workspace',
    sourcePath: '/workspace/figures/source.pdf',
  };
}
