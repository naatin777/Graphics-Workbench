import assert from 'node:assert/strict';
import path from 'node:path';

import { sourceFormatForPath, type SourceFormat } from '../../src/application/policy/source_format.js';
import { runPreflightBatch } from '../../src/operations/input/input_preflight.js';
import { invalidFixtureDirectory, listInputFixturePaths, sourceFixtureDirectory } from '../helpers/fixture_paths.js';

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
  raw: 4,
  svg: 4,
  tiff: 2,
  webp: 2,
};

suite('変換fixtureの契約', () => {
  test('source fixtureは対応形式を網羅し、全件preflightを通過する', async () => {
    const sourcePaths = await listInputFixturePaths(sourceFixtureDirectory);
    const formats = sourcePaths.map((sourcePath) => sourceFormatForPath(sourcePath));
    const actualCounts = countDefinedFormats(formats);
    const result = await runPreflightBatch(sourcePaths);

    assert.deepStrictEqual(actualCounts, expectedSourceFixtureCounts);
    assert.strictEqual(
      result.canProceed,
      true,
      result.errors.map((error) => `${error.sourcePath}: ${error.reason ?? 'unknown error'}`).join('\n'),
    );
    assert.strictEqual(result.reports.length, sourcePaths.length);
  });

  test('invalid Raw fixtureは全件preflightで拒否される', async () => {
    const rawPaths = (await listInputFixturePaths(path.join(invalidFixtureDirectory, 'raw'))).filter((sourcePath) =>
      sourcePath.endsWith('.raw'),
    );
    const result = await runPreflightBatch(rawPaths);

    assert.strictEqual(result.canProceed, false);
    assert.strictEqual(result.errors.length, rawPaths.length);
    assert.ok(result.errors.every((error) => error.format === 'raw'));
  });
});

function countDefinedFormats(formats: (SourceFormat | undefined)[]): Partial<Record<SourceFormat, number>> {
  const counts: Partial<Record<SourceFormat, number>> = {};
  for (const format of formats) {
    assert.ok(format, 'Every source fixture must use a supported input format.');
    counts[format] = (counts[format] ?? 0) + 1;
  }
  return counts;
}
