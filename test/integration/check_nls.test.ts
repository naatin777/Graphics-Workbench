import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

const execFileAsync = promisify(execFile);

suite('NLSの整合性をスクリプトとscannerで検証する', () => {
  test('拡張機能パッケージのcheck-nls.mjsを実行し、英日NLSのkey/placeholder整合性が取れていればstdoutに「NLS consistency OK」を出力しstderrは空のままにする', async () => {
    const extension = vscode.extensions.getExtension('naatin777.graphics-workbench');
    assert.ok(extension);

    const scriptPath = path.join(extension.extensionPath, 'scripts', 'check-nls.mjs');
    const result = await execFileAsync(process.execPath, [scriptPath], {
      cwd: extension.extensionPath,
    });
    assert.match(result.stdout, /NLS consistency OK/);
    assert.strictEqual(result.stderr, '');
  });

  test('{0} {1}の2プレースホルダテンプレートに対し、userMessage呼び出しの置換引数をTypeScript scannerが数え、引数が不足する呼び出し2件だけをerrorとして検出する', async () => {
    const extension = vscode.extensions.getExtension('naatin777.graphics-workbench');
    assert.ok(extension);

    const scriptPath = path.join(extension.extensionPath, 'scripts', 'check-nls.mjs');
    const script = `
      import { validateUserMessageSource } from ${JSON.stringify(pathToFileURL(scriptPath).href)};
      const source = ${JSON.stringify(`
        userMessage("two.placeholders", value);
        userMessage("two.placeholders", format(a, b));
        userMessage("two.placeholders", value, other);
      `)};
      const errors = validateUserMessageSource("fixture.ts", source, { "two.placeholders": "{0} {1}" });
      if (errors.length !== 2) {
        console.error(errors.join("\\n"));
        process.exit(1);
      }
      console.log(errors.length);
    `;
    const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: extension.extensionPath,
    });

    assert.strictEqual(result.stdout.trim(), '2');
    assert.strictEqual(result.stderr, '');
  });
});
