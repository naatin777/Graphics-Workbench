import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import { convertSplitPng, isConversionCancelled, type ConversionSource } from '@graphics-workbench/core/conversion';
import { operationPdfInputDirectory, testConversionConfiguration } from '@graphics-workbench/core/testing';

const testDataPath = path.join(operationPdfInputDirectory, 'single-page-document.pdf');
const maxInputPixels = 268_402_689;

function sourceAt(workspacePath: string, sourcePath: string): ConversionSource {
  return {
    sourcePath,
    workspacePath,
    workspaceName: path.basename(workspacePath),
  };
}

describe('Headless PDF→raster conversion', () => {
  it('PDFをPNG変換し、進捗1/1を報告してPNG出力をcommitする', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-convert-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const progress: [number, number][] = [];

    const result = await convertSplitPng(
      [sourceAt(workspace.path, sourcePath)],
      '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
      testConversionConfiguration({ maxInputPixels }),
      {
        resolveConflicts: async () => 'overwrite',
        reportProgress: (completed, total) => progress.push([completed, total]),
      },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const [output] = result.value;
    assert.ok(output);
    assert.deepStrictEqual(progress, [[1, 1]]);
    assert.strictEqual((await sharp(output.outputPath).metadata()).format, 'png');
    assert.ok((await readFile(output.outputPath)).byteLength > 0);
  });

  it('変換開始前のAbortSignalを既存operationへ伝搬し、出力をcommitしない', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-cancel-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const outputPath = path.join(workspace.path, 'paper', '1.png');
    const abortController = new AbortController();
    abortController.abort();

    const result = await convertSplitPng(
      [sourceAt(workspace.path, sourcePath)],
      '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
      testConversionConfiguration({ maxInputPixels }),
      { signal: abortController.signal },
    );

    assert.ok(result.isErr(), 'pre-aborted conversion should fail');
    assert.ok(isConversionCancelled(result.error), 'aborted conversion should map to CancelledError');
    await assert.rejects(readFile(outputPath));
  });

  it('競合出力のoverwrite後にcommit layerが.previous backupを作成する', async () => {
    await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-raster-overwrite-'));
    const sourcePath = path.join(workspace.path, 'paper.pdf');
    await copyFile(testDataPath, sourcePath);
    const outputPath = path.join(workspace.path, 'paper', '1.png');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'previous content');

    const result = await convertSplitPng(
      [sourceAt(workspace.path, sourcePath)],
      '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
      testConversionConfiguration({ maxInputPixels }),
      { resolveConflicts: async () => 'overwrite' },
    );
    if (result.isErr()) {
      throw result.error;
    }

    const [output] = result.value;
    assert.ok(output?.previousFilePath);
    await readFile(output.previousFilePath);
    assert.strictEqual((await sharp(outputPath).metadata()).format, 'png');
  });
});
