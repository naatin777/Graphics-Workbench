import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commitStagedOutputs, CommitRollbackError } from '../../src/operations/lifecycle/commit_conversion_outputs.js';

suite('変換結果rollbackの外部変更保護', () => {
  test('commit後に外部編集された新規出力を削除しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-new-output-race-'));
    const stagingRootPath = path.join(workspacePath, '.graphics-workbench', 'run');
    const firstStagedPath = path.join(stagingRootPath, 'first.pdf');
    const secondStagedPath = path.join(stagingRootPath, 'second.pdf');
    const firstOutputPath = path.join(workspacePath, 'first.pdf');
    const secondOutputPath = path.join(workspacePath, 'second.pdf');

    try {
      await mkdir(stagingRootPath, { recursive: true });
      await writeFile(firstStagedPath, 'generated first');
      await mkdir(secondStagedPath);

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
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
