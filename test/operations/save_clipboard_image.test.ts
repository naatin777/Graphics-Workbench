import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CommitRollbackError } from '../../src/operations/lifecycle/commit_conversion_outputs.js';
import { saveClipboardImage } from '../../src/operations/input/save_clipboard_image.js';

suite('クリップボード画像保存で、上書き時の退避・復旧処理を管理する', () => {
  test('commit後のrollbackコピーが失敗すると、復旧用backup（source.png.previous）を残し、出力を元のままにしてClipboard外のファイルは変更しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-clipboard-save-'));
    const runId = 'rollback-failure';
    const outputPath = path.join(workspacePath.path, 'pasted.png');
    const clipboardRoot = path.join(workspacePath.path, '.graphics-workbench', 'clipboard-paste', runId);
    const unrelatedRoot = path.join(workspacePath.path, '.graphics-workbench', 'other', 'active');
    const lines: string[] = [];
    let copyCount = 0;

    await writeFile(outputPath, 'original image');
    await mkdir(unrelatedRoot, { recursive: true });
    await writeFile(path.join(unrelatedRoot, 'keep.txt'), 'keep');

    await assert.rejects(
      saveClipboardImage(
        {
          data: { type: { ext: 'png' }, buffer: Buffer.from('new image') },
          kind: 'image',
          outputBasePath: outputPath,
          workspacePath: workspacePath.path,
          runId,
        },
        {
          resolveConflicts: async () => 'overwrite',
          outputChannel: { appendLine: (line) => lines.push(line) },
        },
        {
          commit: {
            copyFile: async (source, destination, flags) => {
              copyCount += 1;

              if (destination !== outputPath && !destination.endsWith('.previous') && copyCount === 2) {
                throw new Error('injected commit copy failure');
              }

              if (destination === outputPath && copyCount === 3) {
                throw new Error('injected rollback copy failure');
              }

              await copyFile(source, destination, flags);
            },
          },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CommitRollbackError);
        assert.match(error.originalError.message, /injected commit copy failure/);
        assert.strictEqual(error.rollbackErrors[0]?.outputPath, outputPath);
        assert.match(error.rollbackErrors[0]?.error.message ?? '', /injected rollback copy failure/);
        return true;
      },
    );

    const backupPath = path.join(clipboardRoot, 'source.png.previous');
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original image');
    assert.strictEqual(await readFile(backupPath, 'utf8'), 'original image');
    assert.strictEqual(await readFile(path.join(unrelatedRoot, 'keep.txt'), 'utf8'), 'keep');
    assert.ok(lines.some((line) => line.includes('rollback failed') && line.includes(outputPath)));
    assert.ok(lines.some((line) => line.includes('preserving recovery backup') && line.includes(backupPath)));
    await assert.doesNotReject(access(backupPath));
  });
});
