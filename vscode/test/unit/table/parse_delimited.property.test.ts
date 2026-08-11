import assert from 'node:assert/strict';

import * as fc from 'fast-check';

import { isTsvTableCandidate, parseCsv, parseTsv } from '../../../src/table/parse_delimited.js';

const csvCellArbitrary = fc
  .array(fc.constantFrom('a', 'Z', '0', ' ', '日本語', ',', '"', '\\', '\r', '\n'), {
    minLength: 1,
    maxLength: 10,
  })
  .map((characters) => characters.join(''));

const csvRowsArbitrary = fc.array(fc.array(csvCellArbitrary, { minLength: 1, maxLength: 5 }), {
  minLength: 1,
  maxLength: 5,
});

const tsvCellArbitrary = fc
  .array(fc.constantFrom('a', 'Z', '0', ' ', '日本語', ',', '"', '\\', '-'), {
    minLength: 1,
    maxLength: 10,
  })
  .map((characters) => characters.join(''));

const tsvRowsArbitrary = fc.array(fc.array(tsvCellArbitrary, { minLength: 1, maxLength: 5 }), {
  minLength: 1,
  maxLength: 5,
});

function encodeCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((field) => {
          if (!/[",\r\n]/u.test(field)) {
            return field;
          }
          return `"${field.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\n');
}

function encodeTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

suite('CSV・TSVパーサーのproperty-based test', () => {
  test('引用符・区切り文字・改行を含む縮小可能なCSV行列をエンコードしてから解析すると元のセルへ戻る', () => {
    fc.assert(
      fc.property(csvRowsArbitrary, (rows) => {
        assert.deepStrictEqual(parseCsv(encodeCsv(rows)), rows);
      }),
    );
  });

  test('区切り文字を含まない縮小可能なTSV行列をエンコードしてから解析すると元のセルへ戻る', () => {
    fc.assert(
      fc.property(tsvRowsArbitrary, (rows) => {
        assert.deepStrictEqual(parseTsv(encodeTsv(rows)), rows);
      }),
    );
  });

  test('任意の文字列をCSV・TSV解析とTSV候補判定へ渡してもthrowしない', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        assert.doesNotThrow(() => parseCsv(text));
        assert.doesNotThrow(() => parseTsv(text));
        assert.doesNotThrow(() => isTsvTableCandidate(text));
      }),
    );
  });
});
