import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { copyFileWithAbort } from '@graphics-workbench/core/operations/lifecycle/copy_file_with_abort.js';

suite('abort可能なファイルcopy処理', () => {
  test('copyFileWithAbortでソースの内容をcopyして宛先と一致することを確認し、COPYFILE_EXCL指定で既存宛先へのcopyがEEXISTエラーで失敗することを確認する', async () => {
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

  test('copy開始前にabort済みのsignalを渡すとcopyを開始せずcancelledエラーで失敗し、宛先ファイルを作成しない', async () => {
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
