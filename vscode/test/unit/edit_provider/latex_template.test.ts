import assert from 'node:assert/strict';

import { renderTemplate, type TemplateContext } from '../../../src/edit_provider/latex_template.js';

suite('LaTeXテンプレートのプレースホルダを画像contextへ置換して文字列を返す', () => {
  const ctx: TemplateContext = {
    path: 'figures/graph.pdf',
    name: 'graph',
    ext: 'pdf',
    page: 2,
    dir: 'figures',
  };

  test('テンプレート内の${path}を画像の相対パスfigures/graph.pdfへ置換する', () => {
    const result = renderTemplate('\\includegraphics{${path}}', ctx);
    assert.strictEqual(result, '\\includegraphics{figures/graph.pdf}');
  });

  test('テンプレート内の${name}を拡張子なしのベース名graphへ置換する', () => {
    const result = renderTemplate('\\label{fig:${name}}', ctx);
    assert.strictEqual(result, '\\label{fig:graph}');
  });

  test('テンプレート内の${ext}を拡張子pdfへ置換する', () => {
    const result = renderTemplate('File type: ${ext}', ctx);
    assert.strictEqual(result, 'File type: pdf');
  });

  test('テンプレート内の${page}をページ番号2へ置換する', () => {
    const result = renderTemplate('page=${page}', ctx);
    assert.strictEqual(result, 'page=2');
  });

  test('テンプレート内の${dir}をディレクトリfiguresへ置換する', () => {
    const result = renderTemplate('from ${dir}', ctx);
    assert.strictEqual(result, 'from figures');
  });

  test('${path}・${name}を含む完全なfigureテンプレートをcontext値へ置換して1つの文字列としてレンダリングする', () => {
    const template = [
      '\\begin{figure}[H]',
      '  \\centering',
      '  \\includegraphics[width=\\linewidth]{${path}}',
      '  \\caption{${name}}',
      '  \\label{fig:${name}}',
      '\\end{figure}',
    ].join('\n');
    const expected = [
      '\\begin{figure}[H]',
      '  \\centering',
      '  \\includegraphics[width=\\linewidth]{figures/graph.pdf}',
      '  \\caption{graph}',
      '  \\label{fig:graph}',
      '\\end{figure}',
    ].join('\n');
    assert.strictEqual(renderTemplate(template, ctx), expected);
  });

  test('contextに存在しない${unknown}は置換せず元の文字列のまま出力する', () => {
    const result = renderTemplate('${unknown}', ctx);
    assert.strictEqual(result, '${unknown}');
  });

  test('path・nameに$を含む場合でも$を置換記号と解釈せず、テンプレートへ正しく埋め込む', () => {
    const context = { path: 'figures/a$&b.pdf', name: 'a$&b', ext: 'pdf', dir: 'figures' };
    const result = renderTemplate('![${name}](${path} "${name}")', context);
    assert.strictEqual(result, '![a$&b](figures/a$&b.pdf "a$&b")');
  });
});
