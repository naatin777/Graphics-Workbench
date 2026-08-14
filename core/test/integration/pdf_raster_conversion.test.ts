import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  inspectPdfRasterSource,
  planPdfRasterConversion,
  resolvePdfRasterPages,
  runPdfRasterConversion,
} from '@graphics-workbench/core/conversion';
import { operationPdfInputDirectory } from '@graphics-workbench/core/testing';

const testDataPath = path.join(operationPdfInputDirectory, 'single-page-document.pdf');
const maxInputPixels = 268_402_689;
const splitOutputTemplate = {
  jpeg: '${fileDirname}/${fileBasenameNoExtension}/${page}.jpeg',
  png: '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
} as const;

describe('Headless PDF→raster conversion', () => {
  it('page rangeは1-3,5,8を1-based pageに展開し、重複は最初の出現だけを保持する', () => {
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'range', value: '1-3,5,8,3' }, 8), {
      ok: true,
      pages: [1, 2, 3, 5, 8],
    });
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'all' }, 3), { ok: true, pages: [1, 2, 3] });
  });

  it('page rangeの空、降順、範囲外、page count 0を明示的に拒否する', () => {
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'range', value: '' }, 3), {
      ok: false,
      kind: 'required',
      token: '',
    });
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'range', value: '3-1' }, 3), {
      ok: false,
      kind: 'descending',
      token: '3-1',
    });
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'range', value: '4' }, 3), {
      ok: false,
      kind: 'outOfRange',
      token: '4',
    });
    assert.deepStrictEqual(resolvePdfRasterPages({ kind: 'all' }, 0), {
      ok: false,
      kind: 'outOfRange',
      token: '0',
    });
  });

  it('選択pageと既存output templateからpage付きRasterInputだけを計画する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-plan-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const source = await inspectPdfRasterSource({ sourcePath });
    const outputTemplate = splitOutputTemplate.jpeg;

    const plan = planPdfRasterConversion({
      source,
      target: 'jpeg',
      selection: { kind: 'range', value: '1' },
      outputTemplate,
    });

    assert.deepStrictEqual(
      plan.inputs.map(({ page, outputPath }) => ({ page, outputPath })),
      [{ page: 1, outputPath: path.join(workspace.path, 'paper', '1.jpeg') }],
    );
  });

  it('PDFをPNG変換し、staging artifactを返す', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-convert-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const source = await inspectPdfRasterSource({ sourcePath });
    const plan = planPdfRasterConversion({
      source,
      target: 'png',
      selection: { kind: 'all' },
      outputTemplate: splitOutputTemplate.png,
    });
    const progress: [number, number][] = [];

    const result = await runPdfRasterConversion({
      plan,
      runtime: {
        resolveConflicts: async () => 'overwrite',
        reportProgress: (completed, total) => progress.push([completed, total]),
      },
      maxInputPixels,
    });

    const [output] = result.outputs;
    assert.ok(output);
    assert.deepStrictEqual(progress, [[1, 1]]);
    assert.strictEqual((await sharp(output.outputPath).metadata()).format, 'png');
    assert.ok((await readFile(output.outputPath)).byteLength > 0);
    assert.strictEqual(result.artifacts.length, 1);
    assert.strictEqual(result.artifacts[0]?.rootPath, output.stagingRootPath);
  });

  it('変換開始前のAbortSignalを既存operationへ伝搬し、出力をcommitしない', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-cancel-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const source = await inspectPdfRasterSource({ sourcePath });
    const plan = planPdfRasterConversion({
      source,
      target: 'png',
      selection: { kind: 'all' },
      outputTemplate: splitOutputTemplate.png,
    });
    const abortController = new AbortController();
    abortController.abort();

    await assert.rejects(
      runPdfRasterConversion({
        plan,
        runtime: { signal: abortController.signal },
        maxInputPixels,
      }),
      { name: 'AbortError' },
    );
    await assert.rejects(access(plan.inputs[0]?.outputPath ?? 'missing-output'));
  });

  it('競合出力のoverwrite後にcommit layerが.previous backupを作成する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-overwrite-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const source = await inspectPdfRasterSource({ sourcePath });
    const plan = planPdfRasterConversion({
      source,
      target: 'png',
      selection: { kind: 'all' },
      outputTemplate: splitOutputTemplate.png,
    });
    const outputPath = plan.inputs[0]?.outputPath;
    assert.ok(outputPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'previous content');

    const result = await runPdfRasterConversion({
      plan,
      runtime: { resolveConflicts: async () => 'overwrite' },
      maxInputPixels,
    });

    const [output] = result.outputs;
    assert.ok(output?.previousFilePath);
    await access(output.previousFilePath);
    assert.strictEqual((await sharp(outputPath).metadata()).format, 'png');
  });
});
