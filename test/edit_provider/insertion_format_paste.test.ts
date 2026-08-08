import assert from 'node:assert/strict';

import { LatexPasteEditProvider } from '../../src/edit_provider/latex_paste_edit_provider.js';

function normalizeSnippetValue(value: string): string {
  return value.replaceAll('\\\\', '\\').replaceAll(/\\([{}])/g, '$1');
}

suite('Typst / Quarkdownクリップボード画像挿入', () => {
  test('Typstで\'figures/edited.png\'を、width: 80%付きの#figure(image("figures/edited.png", width: 80%), caption: [edited])形式のsnippetへ変換する', () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('#figure(image("figures/edited.png", width: 80%), caption: [edited])'));
  });

  test("Quarkdownで'figures/edited.png'を、'![edited](figures/edited.png \"edited\")'形式のsnippetへ変換する", () => {
    const provider = new LatexPasteEditProvider({ format: 'quarkdown' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('![edited](figures/edited.png "edited")'));
  });

  test('LaTeXでは\\includegraphics{figures/edited.png}と\\caption{edited}から成る従来のfigure snippetを作る', () => {
    const provider = new LatexPasteEditProvider();
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures/edited.png').value);

    assert.ok(snippet.includes('\\includegraphics{figures/edited.png}'));
    assert.ok(snippet.includes('\\caption{edited}'));
  });

  test("LaTeXでファイル名'my_file 100%'のアンダースコアとパーセントをエスケープし、captionに'my\\_file 100\\%'を反映する", () => {
    const provider = new LatexPasteEditProvider();
    const snippet = normalizeSnippetValue(
      provider.createSingleFileSnippet('my_file 100%', 'figures/my_file 100%.png').value,
    );

    assert.ok(snippet.includes('\\caption{my\\_file 100\\%}'));
  });

  test("Windows形式'figures\\edited.png'のpath separatorをフォワードスラッシュ'figures/edited.png'へ正規化してsnippetに含める", () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('edited', 'figures\\edited.png').value);

    assert.ok(snippet.includes('figures/edited.png'));
  });

  test("Typstではファイル名'my_file'のアンダースコアをエスケープせず、caption: [my_file]のままsnippetに含める", () => {
    const provider = new LatexPasteEditProvider({ format: 'typst' });
    const snippet = normalizeSnippetValue(provider.createSingleFileSnippet('my_file', 'figures/my_file.png').value);

    assert.ok(snippet.includes('caption: [my_file]'));
  });
});
