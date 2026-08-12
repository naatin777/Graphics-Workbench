import assert from 'node:assert/strict';

import { isTsvTableCandidate, parseCsv, parseTsv } from '../../../../protocol/table/parse_delimited.js';

suite('CSVパーサー', () => {
  test('基本CSVの各行をフィールド配列へ分割する', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  test('ダブルクォートで囲まれたカンマを含むフィールドを1つのフィールドとして扱う', () => {
    assert.deepEqual(parseCsv('a,"b,c",d'), [['a', 'b,c', 'd']]);
  });

  test('""でエスケープされた引用符をフィールドへ含める', () => {
    assert.deepEqual(parseCsv('"say ""hi""",x'), [['say "hi"', 'x']]);
  });

  test('CRLFとLFの両方を行区切りとして扱う', () => {
    assert.deepEqual(parseCsv('a,b\r\nc,d\ne,f'), [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ]);
  });

  test('空セルと末尾の空セルを保持する', () => {
    assert.deepEqual(parseCsv('a,,c,'), [['a', '', 'c', '']]);
    assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
  });

  test('末尾の改行は余分な空行を生成しない', () => {
    assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']]);
    assert.deepEqual(parseCsv('a,b\r\n'), [['a', 'b']]);
  });

  test('空文字列は0行を返す', () => {
    assert.deepEqual(parseCsv(''), []);
  });
});

suite('TSVパーサー', () => {
  test('Excel風TSVをタブ区切りで分割する', () => {
    assert.deepEqual(parseTsv('Method\tTime\tScore\nA\t12.4\t91.2\nB\t10.8\t94.5'), [
      ['Method', 'Time', 'Score'],
      ['A', '12.4', '91.2'],
      ['B', '10.8', '94.5'],
    ]);
  });

  test('空セルと末尾の空セルを保持する', () => {
    assert.deepEqual(parseTsv('a\t\tc\t'), [['a', '', 'c', '']]);
  });

  test('CRLFを行区切りとして扱い、末尾の改行を余分な行にしない', () => {
    assert.deepEqual(parseTsv('a\tb\r\nc\td\r\n'), [
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('空文字列と改行のみの入力は0行を返す', () => {
    assert.deepEqual(parseTsv(''), []);
    assert.deepEqual(parseTsv('\n'), []);
  });

  test('タブを含む場合のみtable candidateと判定する', () => {
    assert.strictEqual(isTsvTableCandidate('This is a plain sentence.'), false);
    assert.strictEqual(isTsvTableCandidate('Method\tTime'), true);
  });
});
