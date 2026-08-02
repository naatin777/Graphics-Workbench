import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';

import {
  createCropProcessChild,
  runCropPdfProcess,
  type CropProcessChild,
} from '../../src/operations/pdf/run_crop_pdf_process.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';

suite('Crop Configure child process', () => {
  test('PDFを子プロセスでcropし、staging outputへ書き込む', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-crop-runner-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'result.pdf');

    try {
      await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
      await runCropPdfProcess({
        sourcePath,
        stagedOutputPath: outputPath,
        cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
        target: { type: 'all' },
      });

      const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
      const document = await PDFDocument.load(await readFile(outputPath));
      assert.deepStrictEqual(document.getPage(0).getMediaBox(), sourceDocument.getPage(0).getMediaBox());
      assert.deepStrictEqual(document.getPage(0).getCropBox(), {
        x: 20,
        y: 30,
        width: 180,
        height: 250,
      });
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('実行前にキャンセルされた場合は子プロセスを起動しない', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      runCropPdfProcess(
        {
          sourcePath: '/tmp/input.pdf',
          stagedOutputPath: '/tmp/output.pdf',
          cropBox: { left: 0, bottom: 0, right: 10, top: 10 },
          target: { type: 'all' },
        },
        controller.signal,
      ),
      /cancelled/,
    );
  });

  test('child wrapperはNode childのmessageを転送し、disposeでNode側listenerを解放する', async () => {
    const runnerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/operations/pdf/crop_pdf_runner.js',
    );
    const underlying = fork(runnerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const child: CropProcessChild = createCropProcessChild(underlying);

    try {
      const message = await new Promise<unknown>((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        underlying.send({ type: 'unknown', protocolVersion: 1, requestId: 'wrapper' });
      });

      assert.deepStrictEqual(message, {
        type: 'failure',
        protocolVersion: 1,
        requestId: 'wrapper',
        error: 'Invalid Crop Configure runner request.',
      });
      assert.strictEqual(underlying.listenerCount('message'), 1);
      child.dispose();
      assert.strictEqual(underlying.listenerCount('message'), 0);
    } finally {
      underlying.kill();
    }
  });
});
