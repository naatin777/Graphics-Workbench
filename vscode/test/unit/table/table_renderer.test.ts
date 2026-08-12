import assert from 'node:assert/strict';

import { setColumnAlignment, tableModelFromRows } from '../../../src/table/table_model.js';
import {
  escapePipeTableCell,
  escapeTypstTableCell,
  renderLatexTable,
  renderQuarkdownTable,
  renderTypstTable,
} from '../../../src/table/table_renderer.js';

const SAMPLE_ROWS = [
  ['Method', 'Time', 'Score'],
  ['A', '12.4', '91.2'],
  ['B', '10.8', '94.5'],
] as const;

suite('テーブルrenderer', () => {
  test('同一TableModelからLaTeXを生成する', () => {
    const model = tableModelFromRows(SAMPLE_ROWS, 1);
    const aligned = setColumnAlignment(
      setColumnAlignment(setColumnAlignment(model, 0, 'left'), 1, 'right'),
      2,
      'right',
    );
    assert.strictEqual(
      renderLatexTable(aligned, { booktabs: true }),
      [
        '\\begin{tabular}{lrr}',
        '\\toprule',
        'Method & Time & Score \\\\',
        '\\midrule',
        'A & 12.4 & 91.2 \\\\',
        'B & 10.8 & 94.5 \\\\',
        '\\bottomrule',
        '\\end{tabular}',
      ].join('\n'),
    );
  });

  test('LaTeXのbooktabs無効時は\\hlineを使う', () => {
    const model = tableModelFromRows(SAMPLE_ROWS, 1);
    assert.strictEqual(
      renderLatexTable(model, { booktabs: false }),
      [
        '\\begin{tabular}{lll}',
        '\\hline',
        'Method & Time & Score \\\\',
        '\\hline',
        'A & 12.4 & 91.2 \\\\',
        'B & 10.8 & 94.5 \\\\',
        '\\hline',
        '\\end{tabular}',
      ].join('\n'),
    );
  });

  test('LaTeXはheader行がない場合も全行を出力する', () => {
    const model = tableModelFromRows(SAMPLE_ROWS.slice(1), 0);
    assert.strictEqual(
      renderLatexTable(model, { booktabs: true }),
      [
        '\\begin{tabular}{lll}',
        '\\toprule',
        'A & 12.4 & 91.2 \\\\',
        'B & 10.8 & 94.5 \\\\',
        '\\bottomrule',
        '\\end{tabular}',
      ].join('\n'),
    );
  });

  test('LaTeXの特殊文字をescapeする', () => {
    const model = tableModelFromRows([['a&b_100%', 'c{d}e']], 0);
    assert.strictEqual(
      renderLatexTable(model, { booktabs: false }),
      ['\\begin{tabular}{ll}', '\\hline', 'a\\&b\\_100\\% & c\\{d\\}e \\\\', '\\hline', '\\end{tabular}'].join('\n'),
    );
  });

  test('同一TableModelからTypstを生成する', () => {
    const model = tableModelFromRows(SAMPLE_ROWS, 1);
    const aligned = setColumnAlignment(
      setColumnAlignment(setColumnAlignment(model, 0, 'left'), 1, 'right'),
      2,
      'right',
    );
    assert.strictEqual(
      renderTypstTable(aligned),
      [
        '#table(',
        '  columns: (auto, auto, auto),',
        '  align: (left, right, right),',
        '  table.header([*#text("Method")*], [*#text("Time")*], [*#text("Score")*]),',
        '  [#text("A")], [#text("12.4")], [#text("91.2")],',
        '  [#text("B")], [#text("10.8")], [#text("94.5")],',
        ')',
      ].join('\n'),
    );
  });

  test('Typstはheader行がない場合にtable.headerを出力しない', () => {
    const model = tableModelFromRows(SAMPLE_ROWS.slice(1), 0);
    assert.strictEqual(
      renderTypstTable(model),
      [
        '#table(',
        '  columns: (auto, auto, auto),',
        '  align: (left, left, left),',
        '  [#text("A")], [#text("12.4")], [#text("91.2")],',
        '  [#text("B")], [#text("10.8")], [#text("94.5")],',
        ')',
      ].join('\n'),
    );
  });

  test('Typstはセル文字列をtext stringへ入れてmarkup記号・括弧・改行をデータとして保持する', () => {
    const model = tableModelFromRows([['A | B *bold* [link]', 'line\nnext']], 1);
    assert.strictEqual(
      renderTypstTable(model),
      [
        '#table(',
        '  columns: (auto, auto),',
        '  align: (left, left),',
        '  table.header([*#text("A | B *bold* [link]")*], [*#text("line\\nnext")*]),',
        ')',
      ].join('\n'),
    );
    assert.strictEqual(escapeTypstTableCell('quote " \\ tab\t'), 'quote \\" \\\\ tab\\t');
  });

  test('同一TableModelからQuarkdownを生成する', () => {
    const model = tableModelFromRows(SAMPLE_ROWS, 1);
    const aligned = setColumnAlignment(
      setColumnAlignment(setColumnAlignment(model, 0, 'left'), 1, 'right'),
      2,
      'right',
    );
    assert.strictEqual(
      renderQuarkdownTable(aligned),
      ['| Method | Time | Score |', '| :--- | ---: | ---: |', '| A | 12.4 | 91.2 |', '| B | 10.8 | 94.5 |'].join('\n'),
    );
  });

  test('Quarkdownはheader行がない場合に空ヘッダー行を出力する', () => {
    const model = tableModelFromRows(SAMPLE_ROWS.slice(1), 0);
    assert.strictEqual(
      renderQuarkdownTable(model),
      ['|  |  |  |', '| :--- | :--- | :--- |', '| A | 12.4 | 91.2 |', '| B | 10.8 | 94.5 |'].join('\n'),
    );
  });

  test('Quarkdownはpipe・markup記号・改行をセル境界の外へ出さない', () => {
    const model = tableModelFromRows([['A | B', 'line\nnext [x] *bold*']], 1);
    assert.strictEqual(
      renderQuarkdownTable(model),
      ['| A \\| B | line<br>next \\[x\\] \\*bold\\* |', '| :--- | :--- |'].join('\n'),
    );
    assert.strictEqual(escapePipeTableCell('a\\b|c'), 'a\\\\b\\|c');
  });
});
