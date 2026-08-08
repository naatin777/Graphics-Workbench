import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { copyFileWithAbort } from '../../src/operations/lifecycle/copy_file_with_abort.js';

suite('abort可能なファイルcopy', () => {
  test('内容をcopyし、COPYFILE_EXCLを維持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-copy-abort-'));
    const sourcePath = path.join(workspacePath.path, 'source.bin');
    const destinationPath = path.join(workspacePath.path, 'destination.bin');

    await writeFile(sourcePath, Buffer.from('copy content'));
    await copyFileWithAbort(sourcePath, destinationPath);

    assert.deepEqual(await readFile(destinationPath), Buffer.from('copy content'));
    await assert.rejects(
      copyFileWithAbort(sourcePath, destinationPath, constants.COPYFILE_EXCL),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST',
    );
  });

  test('開始前にabortされた場合はcopyを開始しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-copy-abort-'));
    const sourcePath = path.join(workspacePath.path, 'source.bin');
    const destinationPath = path.join(workspacePath.path, 'destination.bin');
    const controller = new AbortController();
    controller.abort(new Error('cancelled before copy'));

    await writeFile(sourcePath, 'copy content');
    await assert.rejects(copyFileWithAbort(sourcePath, destinationPath, undefined, controller.signal), /cancelled/u);
    await assert.rejects(readFile(destinationPath), (error: unknown) => {
      return error instanceof Error && 'code' in error && error.code === 'ENOENT';
    });
  });
});
