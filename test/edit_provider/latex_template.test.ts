import assert from 'node:assert/strict';

import { renderTemplate, type TemplateContext } from '../../src/edit_provider/latex_template.js';

suite('LaTeXテンプレートレンダラ', () => {
  const ctx: TemplateContext = {
    path: 'figures/graph.pdf',
    name: 'graph',
    ext: 'pdf',
    page: 2,
    dir: 'figures',
  };

  test('${path}を相対パスに置換する', () => {
    const result = renderTemplate('\\includegraphics{${path}}', ctx);
    assert.strictEqual(result, '\\includegraphics{figures/graph.pdf}');
  });

  test('${name}を拡張子なしのベース名に置換する', () => {
    const result = renderTemplate('\\label{fig:${name}}', ctx);
    assert.strictEqual(result, '\\label{fig:graph}');
  });

  test('${ext}を拡張子に置換する', () => {
    const result = renderTemplate('File type: ${ext}', ctx);
    assert.strictEqual(result, 'File type: pdf');
  });

  test('${page}をページ番号に置換する', () => {
    const result = renderTemplate('page=${page}', ctx);
    assert.strictEqual(result, 'page=2');
  });

  test('${dir}をディレクトリに置換する', () => {
    const result = renderTemplate('from ${dir}', ctx);
    assert.strictEqual(result, 'from figures');
  });

  test('完全なfigureテンプレートをレンダリングする', () => {
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

  test('未定義の変数はそのまま残す', () => {
    const result = renderTemplate('${unknown}', ctx);
    assert.strictEqual(result, '${unknown}');
  });

  test('$を含むファイル名を正しく置換する', () => {
    const context = { path: 'figures/a$&b.pdf', name: 'a$&b', ext: 'pdf', dir: 'figures' };
    const result = renderTemplate('![${name}](${path} "${name}")', context);
    assert.strictEqual(result, '![a$&b](figures/a$&b.pdf "a$&b")');
  });
});
