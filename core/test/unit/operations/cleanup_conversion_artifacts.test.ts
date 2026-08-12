import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtempDisposable, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  commitStagedOutputs,
  CommitRollbackError,
  cleanupConversionArtifacts,
  withStagingCleanup,
} from '@graphics-workbench/core/runtime';

suite(
  '変換結果を一時保存した作業ディレクトリの削除と、commit失敗時に元出力を退避した復旧バックアップ（.previous）の保持',
  () => {
    test('cleanup対象root内のresult.pdfを削除し、attempted 1・succeeded 1・failures 0件を返してOutput Channelへは何も記録しない', async () => {
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

    test('cleanup対象rootがworkspace外へ向くsymlinkの場合は失敗として扱い、失敗root pathをfailuresへ返し、Output Channelへ「[cleanup] failed」と「1/1 artifact roots failed」を記録する', async () => {
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

    test('上書きcommit直後のキャンセルとrollback copy失敗が重なった場合はCommitRollbackErrorを返し、commit済み出力を残して元出力のrecovery backup（result.pdf.previous）を保持する', async () => {
      await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
      const rootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
      const stagedOutputPath = path.join(rootPath, 'result.pdf');
      const outputPath = path.join(workspacePath.path, 'result.pdf');
      const controller = new AbortController();

      await writeFile(outputPath, 'original');
      await writeFixture(stagedOutputPath);

      await assert.rejects(
        withStagingCleanup([{ rootPath, workspacePath: workspacePath.path }], () =>
          commitStagedOutputs(
            [{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath: rootPath }],
            {
              resolveConflicts: async () => 'overwrite',
              signal: controller.signal,
              copyFile: async (source, destination, flags) => {
                if (source.endsWith('.previous') && destination === outputPath) {
                  throw new Error('injected rollback copy failure');
                }
                await copyFile(source, destination, flags);
              },
              rename: async (source, destination) => {
                await rename(source, destination);
                controller.abort();
              },
            },
          ),
        ),
        (error: unknown) => {
          assert.ok(error instanceof CommitRollbackError);
          return true;
        },
      );

      assert.strictEqual(await readFile(outputPath, 'utf8'), 'fixture');
      assert.strictEqual(await readFile(`${stagedOutputPath}.previous`, 'utf8'), 'original');
      await assert.rejects(access(stagedOutputPath));
    });

    test('通常のエラーで失敗した場合はrecovery backup名（.previous）を含めて一時作業ディレクトリ全体を削除する', async () => {
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

    test('rollbackが成功した場合はrecovery backupを残さずに一時作業ディレクトリごと削除し、元出力だけを復元する', async () => {
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

    test('cleanup時はpreservePathsで指定したUndo用backup（result.pdf.previous）だけを残し、一時作業ディレクトリ内の変換結果result.pdfと入力コピーのsource.pdfを削除する', async () => {
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

    test('cleanup対象rootがworkspace外へ解決するsymlinkの場合は、symlink自体も参照先のファイルも削除しない', async () => {
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

    test('cleanupが失敗しても呼び出し側へ例外を伝播させず、workspace内の変換出力output.pdfを削除しない', async () => {
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

    test('cleanupは指定root配下のresult.pdfだけを削除し、別の変換セッションの進行中作業結果（other-active/result.pdf）・対象外の未知ディレクトリ・テスト用停止ログ（.graphics-workbench/harness/stop.log）・workspace外symlinkとその参照先ファイルをそのまま残す', async () => {
      await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-cleanup-workspace-'));
      const currentRoot = path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'current');
      const activePath = path.join(
        workspacePath.path,
        '.graphics-workbench',
        'merge-pdf',
        'other-active',
        'result.pdf',
      );
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
  },
);

async function writeFixture(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'fixture');
}
