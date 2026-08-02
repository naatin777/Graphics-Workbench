import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import { runCropPdfProcess } from '../../src/operations/pdf/run_crop_pdf_process.js';
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

      const document = await PDFDocument.load(await readFile(outputPath));
      assert.deepStrictEqual(document.getPage(0).getMediaBox(), {
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
});
