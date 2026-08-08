import assert from 'node:assert/strict';

import { LatexDropEditProvider } from '../../src/edit_provider/latex_drop_edit_provider.js';

function normalizeSnippetValue(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll(/\\([{}])/g, '$1');
}

suite('Typst / Quarkdownファイルdrag挿入', () => {
  test('Typstで単一PDF\'figures/sample.pdf\'を、#figure(image("figures/sample.pdf"), caption: [sample])形式のfigure snippetへ変換する', () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures/sample.pdf').value);

    assert.ok(snippet.includes('#figure(image("figures/sample.pdf"), caption: [sample])'));
  });

  test("Typstで2つのPDFから'#grid(columns: 2,'で始まり各PDFをcaption付きfigureとして並べたgrid snippetを生成し、末尾を')'で閉じる", () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(
      provider.createMultiplePdfSnippet(['first', 'second'], ['figures/first.pdf', 'figures/second.pdf']).value,
    );

    assert.ok(snippet.startsWith('#grid(columns: 2,'));
    assert.ok(snippet.includes('#figure(image("figures/first.pdf"), caption: [first])'));
    assert.ok(snippet.includes('#figure(image("figures/second.pdf"), caption: [second])'));
    assert.ok(snippet.trimEnd().endsWith(')'));
  });

  test("Quarkdownで単一PDF'figures/sample.pdf'を、'![sample](figures/sample.pdf \"sample\")'形式のfigure snippetへ変換する", () => {
    const provider = new LatexDropEditProvider('quarkdown');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures/sample.pdf').value);

    assert.ok(snippet.includes('![sample](figures/sample.pdf "sample")'));
  });

  test("Quarkdownで2つのPDFから'.row alignment:{spacebetween}'で始まり各PDFの画像参照を並べたrow snippetを生成する", () => {
    const provider = new LatexDropEditProvider('quarkdown');
    const snippet = normalizeSnippetValue(
      provider.createMultiplePdfSnippet(['first', 'second'], ['figures/first.pdf', 'figures/second.pdf']).value,
    );

    assert.ok(snippet.startsWith('.row alignment:{spacebetween}'));
    assert.ok(snippet.includes('![first](figures/first.pdf "first")'));
    assert.ok(snippet.includes('![second](figures/second.pdf "second")'));
  });

  test("Windows形式'figures\\sample.pdf'のpath separatorをフォワードスラッシュ'figures/sample.pdf'へ正規化してsnippetに含める", () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures\\sample.pdf').value);

    assert.ok(snippet.includes('figures/sample.pdf'));
  });

  test("LaTeXでファイル名'my_file 100%'のアンダースコアとパーセントをエスケープし、captionに'my\\_file 100\\%'を含むfigure snippetを作る", () => {
    const provider = new LatexDropEditProvider('latex');
    const snippet = normalizeSnippetValue(
      provider.createSinglePdfSnippet('my_file 100%', 'figures/my_file 100%.pdf').value,
    );

    assert.ok(snippet.includes('\\caption{my\\_file 100\\%}'));
  });
});
