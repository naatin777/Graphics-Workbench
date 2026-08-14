import assert from 'node:assert/strict';
import test from 'node:test';

// Verifies the built package exports (dist) resolve and expose the public
// surface. The vitest suites run against the TypeScript sources through the
// source alias, so this smoke is the only place the built package contract
// is exercised.

void test('@graphics-workbench/core/conversion exposes the conversion API from dist', async () => {
  const module = await import('@graphics-workbench/core/conversion');
  assert.equal(typeof module.combineImagesToPdf, 'function');
  assert.equal(typeof module.convertToPdfFiles, 'function');
  assert.equal(typeof module.executeRasterConversion, 'function');
});

void test('@graphics-workbench/core/pdf exposes the PDF operations API from dist', async () => {
  const module = await import('@graphics-workbench/core/pdf');
  assert.equal(typeof module.rotatePdfFiles, 'function');
  assert.equal(typeof module.mergePdf, 'function');
  assert.equal(typeof module.splitPdfAllPages, 'function');
});

void test('@graphics-workbench/core/formats exposes the format helpers from dist', async () => {
  const module = await import('@graphics-workbench/core/formats');
  assert.equal(typeof module.sourceFormatForPath, 'function');
});

void test('@graphics-workbench/core/runtime exposes the batch lifecycle from dist', async () => {
  const module = await import('@graphics-workbench/core/runtime');
  assert.equal(typeof module.runStagedConversionBatch, 'function');
});

void test('@graphics-workbench/core/output exposes the output path helpers from dist', async () => {
  const module = await import('@graphics-workbench/core/output');
  assert.equal(typeof module.resolveOutputPath, 'function');
});

void test('@graphics-workbench/core/external-tools exposes the tool runners from dist', async () => {
  const module = await import('@graphics-workbench/core/external-tools');
  assert.equal(typeof module.runExternalTool, 'function');
  assert.equal(typeof module.runHeavyProcess, 'function');
});

void test('@graphics-workbench/core/table exposes the table helpers from dist', async () => {
  const module = await import('@graphics-workbench/core/table');
  assert.equal(typeof module.parseCsv, 'function');
  assert.equal(typeof module.parseTsv, 'function');
});

void test('@graphics-workbench/core/crop-worker exposes the crop worker helpers from dist', async () => {
  const module = await import('@graphics-workbench/core/crop-worker');
  assert.equal(typeof module.runCropWorker, 'function');
});

void test('@graphics-workbench/core/testing exposes the testing kit from dist', async () => {
  const module = await import('@graphics-workbench/core/testing');
  assert.equal(typeof module.testInputDirectory, 'string');
  assert.equal(typeof module.requireConfiguredTool, 'function');
});
