import assert from 'node:assert/strict';

import {
  assertPageTemplateForSplitOutput,
  assertRandomTemplateForCombine,
  formatOutputPage,
} from '@graphics-workbench/core/config/output/page_template.js';

suite('分割出力のpageテンプレート', () => {
  test("総数が9なら'1'、12なら'01'、125なら'012'と、総数の桁数に合わせて1始まりのページ番号を0埋めする", () => {
    assert.strictEqual(formatOutputPage(1, 9), '1');
    assert.strictEqual(formatOutputPage(1, 12), '01');
    assert.strictEqual(formatOutputPage(12, 125), '012');
  });

  test('出力ページ数が2以上の場合はテンプレートに${page}変数を要求して例外を投げ、${page}を含めば許可し、ページ数が1なら${page}がなくても許可する', () => {
    assert.throws(() => assertPageTemplateForSplitOutput('${fileDirname}/image.png', 2), /requires \$\{page\}/);
    assert.doesNotThrow(() => assertPageTemplateForSplitOutput('${fileDirname}/image-${page}.png', 2));
    assert.doesNotThrow(() => assertPageTemplateForSplitOutput('${fileDirname}/image.png', 1));
  });

  test('combine出力テンプレートに${random}変数を要求し、なければ例外を投げる', () => {
    assert.throws(() => assertRandomTemplateForCombine('${workspaceFolder}/combined.pdf'), /must contain \$\{random\}/);
    assert.doesNotThrow(() => assertRandomTemplateForCombine('${workspaceFolder}/combined-${random}.pdf'));
  });
});
