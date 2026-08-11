import assert from 'node:assert/strict';

import {
  addTableColumn,
  addTableRow,
  createTableModel,
  removeTableColumn,
  removeTableRow,
  setColumnAlignment,
  setHeaderRows,
  tableModelFromRows,
  updateCellText,
} from '../../src/table/table_model.js';

suite('TableModel', () => {
  test('createTableModelは指定サイズの空テーブルを作る', () => {
    const model = createTableModel(2, 3, 1);
    assert.strictEqual(model.rows.length, 2);
    assert.strictEqual(model.columns.length, 3);
    assert.strictEqual(model.headerRows, 1);
    assert.ok(model.rows.every((row) => row.cells.length === 3 && row.cells.every((cell) => cell.text === '')));
  });

  test('tableModelFromRowsは列数が足りない行を空セルで補完する', () => {
    const model = tableModelFromRows([['a', 'b'], ['c']], 0);
    assert.deepEqual(
      model.rows.map((row) => row.cells.map((cell) => cell.text)),
      [
        ['a', 'b'],
        ['c', ''],
      ],
    );
    assert.strictEqual(model.columns.length, 2);
    assert.ok(model.columns.every((column) => column.alignment === 'left'));
  });

  test('updateCellTextは指定セルのtextだけを変更する', () => {
    const model = updateCellText(tableModelFromRows([['a', 'b']], 0), 0, 1, 'x');
    assert.deepEqual(
      model.rows[0]?.cells.map((cell) => cell.text),
      ['a', 'x'],
    );
  });

  test('行の追加と削除', () => {
    const model = addTableRow(tableModelFromRows([['a']], 0));
    assert.strictEqual(model.rows.length, 2);
    assert.deepEqual(
      model.rows[1]?.cells.map((cell) => cell.text),
      [''],
    );

    const removed = removeTableRow(model, 0);
    assert.strictEqual(removed.rows.length, 1);
    assert.strictEqual(removed.rows[0]?.cells[0]?.text, '');
  });

  test('列の追加と削除', () => {
    const model = addTableColumn(tableModelFromRows([['a'], ['b']], 0));
    assert.strictEqual(model.columns.length, 2);
    assert.ok(model.rows.every((row) => row.cells.length === 2));

    const removed = removeTableColumn(model, 0);
    assert.strictEqual(removed.columns.length, 1);
    assert.deepEqual(
      removed.rows.map((row) => row.cells[0]?.text),
      ['', ''],
    );
  });

  test('列ごとのalignmentとheaderRowsを設定する', () => {
    const model = setColumnAlignment(tableModelFromRows([['a']], 1), 0, 'right');
    assert.strictEqual(model.columns[0]?.alignment, 'right');

    const noHeader = setHeaderRows(model, 0);
    assert.strictEqual(noHeader.headerRows, 0);
  });
});
