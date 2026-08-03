import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { copyFileWithAbort } from '../../src/operations/lifecycle/copy_file_with_abort.js';

suite('abort可能なファイルcopy', () => {
  test('内容をcopyし、COPYFILE_EXCLを維持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-copy-abort-'));
    const sourcePath = path.join(workspacePath, 'source.bin');
    const destinationPath = path.join(workspacePath, 'destination.bin');

    try {
      await writeFile(sourcePath, Buffer.from('copy content'));
      await copyFileWithAbort(sourcePath, destinationPath);

      assert.deepEqual(await readFile(destinationPath), Buffer.from('copy content'));
      await assert.rejects(
        copyFileWithAbort(sourcePath, destinationPath, constants.COPYFILE_EXCL),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST',
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('開始前にabortされた場合はcopyを開始しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-copy-abort-'));
    const sourcePath = path.join(workspacePath, 'source.bin');
    const destinationPath = path.join(workspacePath, 'destination.bin');
    const controller = new AbortController();
    controller.abort(new Error('cancelled before copy'));

    try {
      await writeFile(sourcePath, 'copy content');
      await assert.rejects(copyFileWithAbort(sourcePath, destinationPath, undefined, controller.signal), /cancelled/u);
      await assert.rejects(readFile(destinationPath), (error: unknown) => {
        return error instanceof Error && 'code' in error && error.code === 'ENOENT';
      });
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
