import assert from 'node:assert/strict';

import { escapeLatex, escapeLatexLabel } from '@graphics-workbench/core/table';

describe('LaTeXテキストエスケープ', () => {
  it('caption textの\\ { } $ & # % _ ^ ~を、それぞれ\\textbackslash{}・\\{\\}・\\$・\\&・\\#・\\%・\\_・\\textasciicircum{}・\\textasciitilde{}へescapeする', () => {
    assert.strictEqual(
      escapeLatex('a\\b{c}$d&e#f%g_h^i~j'),
      'a\\textbackslash{}b\\{c\\}\\$d\\&e\\#f\\%g\\_h\\textasciicircum{}i\\textasciitilde{}j',
    );
  });

  it("labelの\\ { } $ & # % _ ^ ~等の不適切な文字をハイフンへ置換し、'dir-file-name-a-b-c-d-e-f-g-h'を生成する", () => {
    assert.strictEqual(escapeLatexLabel('dir\\file name{a}$b&c#d%e_f^g~h'), 'dir-file-name-a-b-c-d-e-f-g-h');
  });

  it("日本語・英数字・ハイフンのみの'図表Example-01'は、escapeとlabel置換のどちらでも変更せずそのまま返す", () => {
    assert.strictEqual(escapeLatex('図表Example-01'), '図表Example-01');
    assert.strictEqual(escapeLatexLabel('図表Example-01'), '図表Example-01');
  });
});
