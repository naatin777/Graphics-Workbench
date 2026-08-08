import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commitStagedOutputs, CommitRollbackError } from '../../src/operations/lifecycle/commit_conversion_outputs.js';
import {
  cleanupConversionArtifacts,
  withStagingCleanup,
} from '../../src/operations/lifecycle/cleanup_conversion_artifacts.js';

suite('変換artifactのライフサイクル', () => {
  test('cleanup結果はrootごとの成功数と失敗対象を返す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const lines: string[] = [];

    await writeFixture(path.join(rootPath, 'result.pdf'));

    const result = await cleanupConversionArtifacts([{ rootPath, workspacePath: workspacePath.path }], {
      appendLine: (line) => lines.push(line),
    });

    assert.deepEqual(result, { attempted: 1, succeeded: 1, failures: [] });
    assert.deepEqual(lines, []);
  });

  test('cleanup失敗は結果とOutput Channelの両方へ記録する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-outside-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const lines: string[] = [];

    await mkdir(path.dirname(rootPath), { recursive: true });
    await symlink(outsidePath.path, rootPath);

    const result = await cleanupConversionArtifacts([{ rootPath, workspacePath: workspacePath.path }], {
      appendLine: (line) => lines.push(line),
    });

    assert.equal(result.attempted, 1);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.rootPath, rootPath);
    assert.match(lines[0] ?? '', /\[cleanup\] failed/iu);
    assert.match(lines[1] ?? '', /1\/1 artifact roots failed/iu);
  });

  test('外側cleanupでもrollback失敗に必要なrecovery backupだけを保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(rootPath, 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'result.pdf');
    let copyCount = 0;

    await writeFile(outputPath, 'original');
    await writeFixture(stagedOutputPath);

    await assert.rejects(
      withStagingCleanup([{ rootPath, workspacePath: workspacePath.path }], () =>
        commitStagedOutputs(
          [{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath: rootPath }],
          {
            resolveConflicts: async () => 'overwrite',
            copyFile: async (source, destination, flags) => {
              copyCount += 1;

              if (destination !== outputPath && !destination.endsWith('.previous') && copyCount === 2) {
                await copyFile(source, destination, flags);
                throw new Error('injected commit copy failure');
              }

              if (destination === outputPath && copyCount === 3) {
                throw new Error('injected rollback copy failure');
              }

              await copyFile(source, destination, flags);
            },
          },
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof CommitRollbackError);
        return true;
      },
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    assert.strictEqual(await readFile(`${stagedOutputPath}.previous`, 'utf8'), 'original');
    await assert.rejects(access(stagedOutputPath));
  });

  test('通常のerrorではpreviousという名前のartifactも保持しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');

    await writeFixture(path.join(rootPath, 'result.pdf.previous'));

    await assert.rejects(
      withStagingCleanup([{ rootPath, workspacePath: workspacePath.path }], async () => {
        throw new Error('injected ordinary failure');
      }),
      /injected ordinary failure/,
    );

    await assert.rejects(access(rootPath));
  });

  test('rollbackが成功した場合はrecovery backupを保持しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(rootPath, 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'result.pdf');
    let copyCount = 0;

    await writeFile(outputPath, 'original');
    await writeFixture(stagedOutputPath);

    await assert.rejects(
      withStagingCleanup([{ rootPath, workspacePath: workspacePath.path }], () =>
        commitStagedOutputs(
          [{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath: rootPath }],
          {
            resolveConflicts: async () => 'overwrite',
            copyFile: async (source, destination, flags) => {
              copyCount += 1;
              await copyFile(source, destination, flags);

              if (destination !== outputPath && !destination.endsWith('.previous') && copyCount === 2) {
                throw new Error('injected commit failure');
              }
            },
          },
        ),
      ),
      /injected commit failure/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'original');
    await assert.rejects(access(rootPath));
  });

  test('Undo用backupを残してstaging結果と入力コピーを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const resultPath = path.join(rootPath, 'result.pdf');
    const sourcePath = path.join(rootPath, 'source.pdf');
    const backupPath = path.join(rootPath, 'result.pdf.previous');

    await writeFixture(resultPath);
    await writeFixture(sourcePath);
    await writeFixture(backupPath);

    await cleanupConversionArtifacts([{ rootPath, workspacePath: workspacePath.path, preservePaths: [backupPath] }]);

    await assert.rejects(access(resultPath));
    await assert.rejects(access(sourcePath));
    await assert.doesNotReject(access(backupPath));
  });

  test('workspace外へ解決するsymlinkをcleanupしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-outside-'));
    const outsideFile = path.join(outsidePath.path, 'keep.txt');
    const symlinkPath = path.join(workspacePath.path, '.graphics-workbench', 'run');

    await writeFixture(outsideFile);
    await mkdir(path.dirname(symlinkPath), { recursive: true });
    await symlink(outsidePath.path, symlinkPath);

    await cleanupConversionArtifacts([{ rootPath: symlinkPath, workspacePath: workspacePath.path }]);

    await assert.doesNotReject(access(outsideFile));
    await assert.doesNotReject(access(symlinkPath));
  });

  test('cleanup失敗を成功結果へ伝播させずworkspace内の出力を維持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-outside-'));
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const symlinkPath = path.join(workspacePath.path, '.graphics-workbench', 'run');

    await writeFixture(outputPath);
    await mkdir(path.dirname(symlinkPath), { recursive: true });
    await symlink(outsidePath.path, symlinkPath);

    await cleanupConversionArtifacts([{ rootPath: symlinkPath, workspacePath: workspacePath.path }]);

    await assert.doesNotReject(access(outputPath));
  });

  test('operation cleanupは別session・未知directory・harness log・symlinkを削除しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
    const currentRoot = path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'current');
    const activePath = path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'other-active', 'result.pdf');
    const unknownPath = path.join(workspacePath.path, '.graphics-workbench', 'unknown', 'keep.txt');
    const harnessLogPath = path.join(workspacePath.path, '.graphics-workbench', 'harness', 'stop.log');
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-outside-'));
    const outsideFile = path.join(outsidePath.path, 'keep.txt');
    const symlinkPath = path.join(workspacePath.path, '.graphics-workbench', 'link');

    await writeFixture(path.join(currentRoot, 'result.pdf'));
    await writeFixture(activePath);
    await writeFixture(unknownPath);
    await writeFixture(harnessLogPath);
    await writeFixture(outsideFile);
    await mkdir(path.dirname(symlinkPath), { recursive: true });
    await symlink(outsidePath.path, symlinkPath);

    await cleanupConversionArtifacts([{ rootPath: currentRoot, workspacePath: workspacePath.path }]);

    await assert.rejects(access(path.join(currentRoot, 'result.pdf')));
    await assert.doesNotReject(access(activePath));
    await assert.doesNotReject(access(unknownPath));
    await assert.doesNotReject(access(harnessLogPath));
    await assert.doesNotReject(access(symlinkPath));
    await assert.doesNotReject(access(outsideFile));
  });
});

async function writeFixture(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'fixture');
}
