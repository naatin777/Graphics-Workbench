import assert from 'node:assert/strict';
import path from 'node:path';

import { sourceFormatForPath, type SourceFormat } from '../../src/application/policy/source_format.js';
import { listInputFixturePaths, testInputDirectory } from '../helpers/fixture_paths.js';

const expectedSourceFixtureCounts: Partial<Record<SourceFormat, number>> = {
  avif: 2,
  drawio: 1,
  'editable-drawio-png': 1,
  'editable-drawio-svg': 1,
  eps: 2,
  gif: 2,
  jpeg: 2,
  mermaid: 3,
  pdf: 4,
  png: 3,
  svg: 4,
  tiff: 2,
  webp: 2,
};

suite('変換fixtureの契約', () => {
  test('source fixtureは対応形式と期待件数を網羅する', async () => {
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
