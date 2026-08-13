import assert from 'node:assert/strict';

import * as fc from 'fast-check';

import { parsePdfPageSelection } from '@graphics-workbench/core/formats';

interface ExpectedPageToken {
  text: string;
  pages: number[];
}

function pageTokenArbitrary(pageCount: number): fc.Arbitrary<ExpectedPageToken> {
  return fc.oneof(
    fc.integer({ min: 1, max: pageCount }).map((page) => ({ text: String(page), pages: [page] })),
    fc.integer({ min: 1, max: pageCount }).chain((start) =>
      fc.integer({ min: start, max: pageCount }).map((end) => ({
        text: `${start} - ${end}`,
        pages: pagesInRange(start, end),
      })),
    ),
    fc.integer({ min: 1, max: pageCount }).map((start) => ({
      text: `${start} -`,
      pages: pagesInRange(start, pageCount),
    })),
  );
}

function pagesInRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
}

const validSelectionArbitrary = fc
  .integer({ min: 1, max: 20 })
  .chain((pageCount) =>
    fc.array(pageTokenArbitrary(pageCount), { minLength: 1, maxLength: 5 }).map((tokens) => ({ pageCount, tokens })),
  );

suite('PDFページ選択パーサーのproperty-based test', () => {
  test('縮小可能な単一ページ・閉区間・開区間をカンマで連結して解析すると、各tokenのページ列を順番どおり連結する', () => {
    fc.assert(
      fc.property(validSelectionArbitrary, ({ pageCount, tokens }) => {
        const result = parsePdfPageSelection(tokens.map((token) => token.text).join(','), pageCount);

        assert.deepStrictEqual(result, {
          ok: true,
          pages: tokens.flatMap((token) => token.pages),
        });
      }),
    );
  });

  test('任意の文字列と1から20ページのpageCountを解析してもthrowせず、成功時は全ページを範囲内で返す', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 20 }), (raw, pageCount) => {
        assert.doesNotThrow(() => parsePdfPageSelection(raw, pageCount));

        const result = parsePdfPageSelection(raw, pageCount);
        if (result.ok) {
          assert.ok(result.pages.every((page) => Number.isInteger(page) && page >= 1 && page <= pageCount));
        } else {
          assert.ok(['required', 'malformed', 'wholeNumber', 'descending', 'outOfRange'].includes(result.kind));
          assert.strictEqual(typeof result.token, 'string');
        }
      }),
    );
  });
});
