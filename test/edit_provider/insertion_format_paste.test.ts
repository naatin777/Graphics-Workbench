import assert from 'node:assert/strict';

import { LatexPasteEditProvider } from '../../src/edit_provider/latex_paste_edit_provider.js';

function normalizeSnippetValue(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll(/\\([{}])/g, '$1');
}

suite('Typst / Quarkdownクリップボード画像挿入', () => {
  test('Typstの画像テンプレートでsnippetを作る', () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('#figure(image("figures/edited.png", width: 80%), caption: [edited])'));
  });

  test('Quarkdownの画像テンプレートでsnippetを作る', () => {
    const provider = new LatexPasteEditProvider({ format: 'quarkdown' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('![edited](figures/edited.png "edited")'));
  });

  test('LaTeXの画像テンプレートを維持する', () => {
    const provider = new LatexPasteEditProvider();
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('\\includegraphics{figures/edited.png}'));
    assert.ok(snippet.includes('\\caption{edited}'));
  });

  test('LaTeXのファイル名をエスケープする', () => {
    const provider = new LatexPasteEditProvider();
    const snippet = normalizeSnippetValue(
      provider.createSingleFileSnippet('my_file 100%', 'figures/my_file 100%.png').value,
    );

    assert.ok(snippet.includes('\\caption{my\\_file 100\\%}'));
  });

  test('パスをフォワードスラッシュへ正規化する', () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures\\edited.png').value);

    assert.ok(snippet.includes('figures/edited.png'));
  });

  test('Typstのファイル名はエスケープしない', () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('my_file', 'figures/my_file.png').value);

    assert.ok(snippet.includes('caption: [my_file]'));
  });
});
