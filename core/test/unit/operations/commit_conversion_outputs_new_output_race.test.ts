import assert from 'node:assert/strict';
import { mkdir, mkdtempDisposable, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commitStagedOutputs, CommitRollbackError } from '@graphics-workbench/core/runtime';

describe('新規出力の取り消し時に他プロセスが置き換えた場合は置き換え後の内容を保持し、削除しない保護', () => {
  it('新規出力（second.pdf）のrollback中に、他プロセスがcommit済みの別の新規出力（first.pdf）を外部編集で置き換えた場合、rollbackは置き換え後の内容を削除せず保持し、対象のsecond出力だけを削除する', async () => {
    await using workspacePathDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-new-output-race-'));
    const workspacePath = workspacePathDisposable.path;
    const stagingRootPath = path.join(workspacePath, '.graphics-workbench', 'run');
    const firstStagedPath = path.join(stagingRootPath, 'first.pdf');
    const secondStagedPath = path.join(stagingRootPath, 'second.pdf');
    const thirdStagedPath = path.join(stagingRootPath, 'third.pdf');
    const firstOutputPath = path.join(workspacePath, 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'second.pdf');
    const thirdOutputPath = path.join(workspacePath, 'third.pdf');

    await mkdir(stagingRootPath, { recursive: true });
    await writeFile(firstStagedPath, 'generated first');
    await writeFile(secondStagedPath, 'generated second');
    await mkdir(thirdStagedPath);

    await assert.rejects(
      commitStagedOutputs(
        [
          {
            stagedOutputPath: firstStagedPath,
            outputPath: firstOutputPath,
            workspacePath,
            stagingRootPath,
          },
          {
            stagedOutputPath: secondStagedPath,
            outputPath: secondOutputPath,
            workspacePath,
            stagingRootPath,
          },
          {
            stagedOutputPath: thirdStagedPath,
            outputPath: thirdOutputPath,
            workspacePath,
            stagingRootPath,
          },
        ],
        {
          rm: async (filePath, options) => {
            if (filePath === secondOutputPath) {
              await writeFile(firstOutputPath, 'external edit');
            }

            return rm(filePath, options);
          },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof CommitRollbackError);
        assert.strictEqual(error.rollbackErrors.length, 1);
        assert.strictEqual(error.rollbackErrors[0]?.outputPath, firstOutputPath);
        return true;
      },
    );

    assert.strictEqual(await readFile(firstOutputPath, 'utf8'), 'external edit');
    await assert.rejects(readFile(secondOutputPath));
    await assert.rejects(readFile(thirdOutputPath));
  });
});
