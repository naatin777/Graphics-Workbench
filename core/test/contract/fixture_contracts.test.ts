import assert from 'node:assert/strict';
import path from 'node:path';

import { sourceFormatForPath, type SourceFormat } from '@graphics-workbench/core/formats';
import { listInputFixturePaths, testInputDirectory } from '@graphics-workbench/core/testing';

const expectedSourceFixtureCounts: Partial<Record<SourceFormat, number>> = {
  avif: 2,
  drawio: 2,
  'editable-drawio-png': 1,
  'editable-drawio-svg': 1,
  gif: 2,
  jpeg: 2,
  pdf: 4,
  png: 3,
  svg: 5,
  tiff: 2,
  webp: 2,
};

describe('変換用テスト入力の、形式ごとの件数が期待値テーブルと一致する', () => {
  it('validテスト入力ディレクトリを形式ごとに走査し、sourceFormatForPathで判定した形式別の件数が期待値テーブルと一致する', async () => {
    const sourcePaths = (
      await Promise.all(
        [...new Set(Object.keys(expectedSourceFixtureCounts).map(inputDirectoryForFormat))].map((format) =>
          listInputFixturePaths(path.join(testInputDirectory, 'valid', format)),
        ),
      )
    ).flat();
    const formats = sourcePaths.map((sourcePath) => sourceFormatForPath(sourcePath));
    const actualCounts = countDefinedFormats(formats);

    assert.deepStrictEqual(actualCounts, expectedSourceFixtureCounts);
  });
});

function inputDirectoryForFormat(format: string): string {
  return format === 'editable-drawio-png' || format === 'editable-drawio-svg' ? 'drawio' : format;
}

function countDefinedFormats(formats: (SourceFormat | undefined)[]): Partial<Record<SourceFormat, number>> {
  const counts: Partial<Record<SourceFormat, number>> = {};
  for (const format of formats) {
    assert.ok(format, 'Every source fixture must use a supported input format.');
    counts[format] = (counts[format] ?? 0) + 1;
  }
  return counts;
}
