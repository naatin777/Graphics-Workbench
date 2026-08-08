import assert from 'node:assert/strict';

import { LatexDropEditProvider } from '../../src/edit_provider/latex_drop_edit_provider.js';

function normalizeSnippetValue(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll(/\\([{}])/g, '$1');
}

suite('Typst / Quarkdownファイルdrag挿入', () => {
  test('Typst単一PDFからfigure snippetを作る', () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures/sample.pdf').value);

    assert.ok(snippet.includes('#figure(image("figures/sample.pdf"), caption: [sample])'));
  });

  test('Typst複数PDFからgrid snippetを作る', () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(
      provider.createMultiplePdfSnippet(['first', 'second'], ['figures/first.pdf', 'figures/second.pdf']).value,
    );

    assert.ok(snippet.startsWith('#grid(columns: 2,'));
    assert.ok(snippet.includes('#figure(image("figures/first.pdf"), caption: [first])'));
    assert.ok(snippet.includes('#figure(image("figures/second.pdf"), caption: [second])'));
    assert.ok(snippet.trimEnd().endsWith(')'));
  });

  test('Quarkdown単一PDFからfigure snippetを作る', () => {
    const provider = new LatexDropEditProvider('quarkdown');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures/sample.pdf').value);

    assert.ok(snippet.includes('![sample](figures/sample.pdf "sample")'));
  });

  test('Quarkdown複数PDFからrow snippetを作る', () => {
    const provider = new LatexDropEditProvider('quarkdown');
    const snippet = normalizeSnippetValue(
      provider.createMultiplePdfSnippet(['first', 'second'], ['figures/first.pdf', 'figures/second.pdf']).value,
    );

    assert.ok(snippet.startsWith('.row alignment:{spacebetween}'));
    assert.ok(snippet.includes('![first](figures/first.pdf "first")'));
    assert.ok(snippet.includes('![second](figures/second.pdf "second")'));
  });

  test('Windowsのpath separatorを正規化する', () => {
    const provider = new LatexDropEditProvider('typst');
    const snippet = normalizeSnippetValue(provider.createSinglePdfSnippet('sample', 'figures\\sample.pdf').value);

    assert.ok(snippet.includes('figures/sample.pdf'));
  });

  test('LaTeX単一PDFのファイル名をエスケープする', () => {
    const provider = new LatexDropEditProvider('latex');
    const snippet = normalizeSnippetValue(
      provider.createSinglePdfSnippet('my_file 100%', 'figures/my_file 100%.pdf').value,
    );

    assert.ok(snippet.includes('\\caption{my\\_file 100\\%}'));
  });
});
