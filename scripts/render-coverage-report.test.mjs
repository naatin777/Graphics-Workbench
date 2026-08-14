import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { generateCoverageReport, summarizeExtensionCoverage } from '../.github/scripts/render-coverage-report.mjs';

const coreCoverage = ['SF:/workspace/core/src/example.ts', 'DA:1,1', 'end_of_record'].join('\n');
const vscodeCoverage = ['SF:C:\\workspace\\vscode\\extension\\src\\extension.ts', 'DA:2,2', 'end_of_record'].join('\n');

void test('coverage report collector includes Core and VS Code ownership paths', () => {
  const summary = summarizeExtensionCoverage(`${coreCoverage}\n${vscodeCoverage}`, 'Linux');
  assert.deepStrictEqual([...summary.files.keys()], ['core/src/example.ts', 'vscode/extension/src/extension.ts']);
  assert.equal(summary.total, 2);
  assert.equal(summary.covered, 2);
});

void test('coverage report collector rejects empty and single-owner LCOV', () => {
  assert.throws(() => summarizeExtensionCoverage('', 'Linux'), /Linux Extension Host coverage is empty/u);
  assert.throws(
    () => summarizeExtensionCoverage(coreCoverage, 'Linux'),
    /does not contain vscode\/extension\/src\/ sources/u,
  );
});

void test('coverage report aggregate consumes the CI artifact layout end to end', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'gw-coverage-report-'));
  try {
    const extensionLcov = `${coreCoverage}\n${vscodeCoverage}`;
    for (const label of ['Linux', 'macOS', 'Windows']) {
      const directory = path.join(temporaryDirectory, `vscode-extension-host-coverage-${label}`);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'lcov.info'), extensionLcov);
    }

    const webviewDirectory = path.join(temporaryDirectory, 'webview-vitest-coverage');
    await mkdir(webviewDirectory, { recursive: true });
    const webviewLcov = ['SF:src/pages/crop-pdf/app.tsx', 'DA:10,1', 'end_of_record'].join('\n');
    await writeFile(path.join(webviewDirectory, 'lcov.info'), webviewLcov);

    const outputPath = path.join(temporaryDirectory, 'report.md');
    await generateCoverageReport(temporaryDirectory, outputPath);

    const report = await readFile(outputPath, 'utf8');
    assert.match(report, /### Extension Host/u);
    assert.match(report, /\| Linux \| 100\.0% \| 2\/2 \| 2 \| 0 \|/u);
    assert.match(report, /\| macOS \| 100\.0% \| 2\/2 \| 2 \| 0 \|/u);
    assert.match(report, /\| Windows \| 100\.0% \| 2\/2 \| 2 \| 0 \|/u);
    assert.match(report, /### Webview \(Vitest \/ Linux\)/u);
    assert.match(report, /\| 100\.0% \| 1\/1 \| 1 \| 0 \|/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
