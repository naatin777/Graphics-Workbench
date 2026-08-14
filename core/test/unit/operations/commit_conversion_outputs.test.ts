// Test target:
// - 変換結果の競合を1回の判断で安全に反映すること
// - keep-both、cancel、overwriteとバックアップの挙動
//
// Mocked:
// - 競合時のユーザー判断
//
// - 変換処理そのもの

import assert from 'node:assert/strict';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  mkdtempDisposable,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commitStagedOutputs, CommitRollbackError, OperationCancelledError } from '@graphics-workbench/core/runtime';
import { requireValue } from '@graphics-workbench/core/testing';

describe('作業ディレクトリに置いた変換結果を出力ファイルへ反映し（既存は.previousへ退避・両方残す選択で連番保存・失敗時は元の内容へ復元）', () => {
  it('既存のsample.pdfとsample-1.pdfが両方ある状態で両方保持する選択肢を選ぶと、変換結果を未使用の最小連番sample-2.pdfへ保存し、既存2ファイルは変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');
    await writeFixture(path.join(workspacePath, 'sample-1.pdf'), 'old-1');

    const committed = await commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
      resolveConflicts: async () => 'keep-both',
    });

    assert.strictEqual(committed[0]?.outputPath, path.join(workspacePath, 'sample-2.pdf'));
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'old');
    assert.strictEqual(await readFile(path.join(workspacePath, 'sample-2.pdf'), 'utf8'), 'new');
  });

  it('2件の出力が両方とも既存でも、競合判断のresolveConflictsは1回だけ呼び、その1回の呼び出しに両方の出力pathを渡す', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const outputs = await Promise.all(
      ['first', 'second'].map(async (name) => {
        const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', `${name}.pdf`);
        const outputPath = path.join(workspacePath, `${name}.pdf`);
        await writeFixture(stagedOutputPath, `new-${name}`);
        await writeFixture(outputPath, `old-${name}`);
        return { stagedOutputPath, outputPath, workspacePath };
      }),
    );
    const decisions: string[][] = [];

    await commitStagedOutputs(outputs, {
      resolveConflicts: async (conflicts: string[]) => {
        decisions.push(conflicts);
        return 'keep-both';
      },
    });

    assert.strictEqual(decisions.length, 1);
    assert.deepStrictEqual(new Set(decisions[0]), new Set(outputs.map((item) => item.outputPath)));
  });

  it('実volumeのcase sensitivityをprobeで判定し、case-insensitiveなvolumeではFigure.pdfとfigure.pdfを同一出力としてエラーにし、case-sensitiveなら両方commitする', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-case-test-'));
    const firstStagedPath = path.join(workspacePath.path, '.graphics-workbench', 'first.pdf');
    const secondStagedPath = path.join(workspacePath.path, '.graphics-workbench', 'second.pdf');
    const firstOutputPath = path.join(workspacePath.path, 'Figure.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'figure.pdf');

    await writeFixture(firstStagedPath, 'first');
    await writeFixture(secondStagedPath, 'second');
    const probePath = path.join(workspacePath.path, `.case-probe-${crypto.randomUUID()}`);
    await writeFile(probePath, '');
    let caseInsensitive = false;
    try {
      await access(probePath.toUpperCase());
      caseInsensitive = true;
    } catch {
      caseInsensitive = false;
    }
    await rm(probePath, { force: true });

    const outputs = [
      { stagedOutputPath: firstStagedPath, outputPath: firstOutputPath, workspacePath: workspacePath.path },
      { stagedOutputPath: secondStagedPath, outputPath: secondOutputPath, workspacePath: workspacePath.path },
    ];

    if (caseInsensitive) {
      await assert.rejects(commitStagedOutputs(outputs), /same output/);
    } else {
      const committed = await commitStagedOutputs(outputs);
      assert.strictEqual(committed.length, 2);
    }
  });

  it('UnicodeのNFC正規化後に同一path（Cafe+U+0301とCafé）へ解決する2件の出力は、重複として/same output/エラーで拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-unicode-test-'));
    const firstStagedPath = path.join(workspacePath.path, '.graphics-workbench', 'first.pdf');
    const secondStagedPath = path.join(workspacePath.path, '.graphics-workbench', 'second.pdf');
    const firstOutputPath = path.join(workspacePath.path, 'Cafe\u0301.pdf');
    const secondOutputPath = path.join(workspacePath.path, 'Café.pdf');

    await writeFixture(firstStagedPath, 'first');
    await writeFixture(secondStagedPath, 'second');
    await assert.rejects(
      commitStagedOutputs([
        { stagedOutputPath: firstStagedPath, outputPath: firstOutputPath, workspacePath: workspacePath.path },
        { stagedOutputPath: secondStagedPath, outputPath: secondOutputPath, workspacePath: workspacePath.path },
      ]),
      /same output/,
    );
  });

  it('既存出力に対して競合判断でcancelを選ぶと、cancelledエラーを返して既存の出力ファイルを変更しない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
        resolveConflicts: async () => 'cancel',
      }),
      /cancelled/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'old');
  });

  it('overwriteを選ぶと、上書き前に既存の出力内容を.previous backupへコピーしてから変換結果で上書きする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');

    const committed = await commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
      resolveConflicts: async () => 'overwrite',
    });

    const previousFilePath = committed[0]?.previousFilePath;
    assert.ok(previousFilePath);
    assert.strictEqual(await readFile(previousFilePath, 'utf8'), 'old');
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'new');
  });

  it('overwrite前に既存出力のmode（0o640）とmtimeを記録したmetadataを返し、Windows以外ではmodeも検証する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath.path, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'sample.pdf');
    const originalMtime = new Date(2005, 5, 15, 12, 34, 56, 789);

    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');
    await utimes(outputPath, originalMtime, originalMtime);
    if (process.platform !== 'win32') {
      await chmod(outputPath, 0o640);
    }

    const committed = await commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path }], {
      resolveConflicts: async () => 'overwrite',
    });

    const metadata = committed[0]?.previousFileMetadata;
    assert.ok(metadata);
    assert.strictEqual(metadata.mtimeMs, originalMtime.getTime());
    if (process.platform !== 'win32') {
      assert.strictEqual(metadata.mode, 0o640);
    }
  });

  it('1件目をcommitした後、2件目のcopyが失敗した場合は両方の出力を元の内容（old-first/old-second）へ復元し、1件目のmtimeも元へ戻す', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const outputs = await Promise.all(
      ['first', 'second'].map(async (name) => {
        const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', `${name}.pdf`);
        const outputPath = path.join(workspacePath, `${name}.pdf`);
        await writeFixture(stagedOutputPath, `new-${name}`);
        await writeFixture(outputPath, `old-${name}`);
        return { stagedOutputPath, outputPath, workspacePath };
      }),
    );
    const originalMtime = new Date(2005, 5, 15, 12, 34, 56, 789);
    await utimes(outputs[0]?.outputPath ?? '', originalMtime, originalMtime);
    let copyCount = 0;

    await assert.rejects(
      commitStagedOutputs(outputs, {
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          copyCount += 1;
          await copyFile(source, destination, flags);
          if (copyCount === 4) {
            throw new Error('injected second output copy failure');
          }
        },
      }),
      /injected second output copy failure/,
    );

    assert.strictEqual(await readFile(outputs[0]?.outputPath ?? '', 'utf8'), 'old-first');
    assert.strictEqual(await readFile(outputs[1]?.outputPath ?? '', 'utf8'), 'old-second');
    const restored = await stat(outputs[0]?.outputPath ?? '');
    assert.strictEqual(restored.mtimeMs, originalMtime.getTime());
  });

  it('overwrite中のcopy失敗が起きた場合も、.previous backupから元の出力（old）を復元する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          await copyFile(source, destination, flags);
          if (destination !== outputPath && !destination.endsWith('.previous')) {
            throw new Error('injected current output copy failure');
          }
        },
      }),
      /injected current output copy failure/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'old');
  });

  it('新規出力の反映が一時ファイルへのコピーで失敗した場合、作成途中の出力ファイルを削除して不完全なファイルを残さない', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagingRootPath = path.join(workspacePath, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    const outputPath = path.join(workspacePath, 'new.pdf');
    await mkdir(stagingRootPath, { recursive: true });
    await mkdir(stagedOutputPath);

    await assert.rejects(commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath, stagingRootPath }]));

    await assert.rejects(readFile(outputPath));
  });

  it('2件目出力をcommitした直後のキャンセルで2件目のrollbackが失敗すると、CommitRollbackErrorに元のcancelとrollback失敗した出力pathを保持し、Output Channelへ「rollback failed」を記録する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const outputs = await Promise.all(
      ['first', 'second'].map(async (name) => {
        const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', `${name}.pdf`);
        const outputPath = path.join(workspacePath, `${name}.pdf`);
        await writeFixture(stagedOutputPath, `new-${name}`);
        await writeFixture(outputPath, `old-${name}`);
        return { stagedOutputPath, outputPath, workspacePath };
      }),
    );
    const lines: string[] = [];
    const controller = new AbortController();

    await assert.rejects(
      commitStagedOutputs(outputs, {
        signal: controller.signal,
        resolveConflicts: async () => 'overwrite',
        operationName: 'test-rollback',
        outputChannel: { appendLine: (line) => lines.push(line) },
        copyFile: async (source, destination, flags) => {
          if (source === `${outputs[1]?.stagedOutputPath}.previous` && destination === outputs[1]?.outputPath) {
            throw new Error('injected rollback failure');
          }
          await copyFile(source, destination, flags);
        },
        rename: async (source, destination) => {
          await rename(source, destination);
          if (destination === outputs[1]?.outputPath) {
            controller.abort();
          }
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommitRollbackError);
        assert.match(error.originalError.message, /aborted/);
        assert.strictEqual(error.rollbackErrors[0]?.outputPath, outputs[1]?.outputPath);
        return true;
      },
    );

    assert.ok(lines.some((line) => line.includes('rollback failed') && line.includes('second.pdf')));
  });

  it('上書き用の一時ファイルへのコピー完了時にキャンセルされた場合は、最終出力のrenameを開始せず元の出力（old）を維持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    const controller = new AbortController();
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');
    let copyCount = 0;
    let renameCount = 0;

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
        signal: controller.signal,
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          copyCount += 1;
          await copyFile(source, destination, flags);
          if (copyCount === 2) {
            controller.abort();
          }
        },
        rename: async (source, destination) => {
          renameCount += 1;
          await rename(source, destination);
        },
      }),
      /aborted/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'old');
    assert.strictEqual(renameCount, 0);
  });

  it('commit後に他プロセスが出力を外部変更した場合、rollbackではその出力を上書きせず、外部変更を保持したまま元内容のrecovery backup（.previous）を残す', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagingRootPath = path.join(workspacePath, '.graphics-workbench', 'run');
    const outputs = await Promise.all(
      ['first', 'second'].map(async (name) => {
        const stagedOutputPath = path.join(stagingRootPath, `${name}.pdf`);
        const outputPath = path.join(workspacePath, `${name}.pdf`);
        await writeFixture(stagedOutputPath, `new-${name}`);
        await writeFixture(outputPath, `old-${name}`);
        return { stagedOutputPath, outputPath, workspacePath, stagingRootPath };
      }),
    );
    let copyCount = 0;
    let recoveryBackupPath = '';

    await assert.rejects(
      commitStagedOutputs(outputs, {
        resolveConflicts: async () => 'overwrite',
        rename: async (source, destination) => {
          await rename(source, destination);
          if (destination === outputs[0]?.outputPath) {
            await writeFile(destination, 'external change after commit');
          }
        },
        copyFile: async (source, destination, flags) => {
          copyCount += 1;
          await copyFile(source, destination, flags);
          if (copyCount === 4) {
            throw new Error('injected second output failure');
          }
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof CommitRollbackError);
        assert.match(error.originalError.message, /injected second output failure/);
        assert.strictEqual(error.rollbackErrors.length, 1);
        assert.strictEqual(error.rollbackErrors[0]?.outputPath, outputs[0]?.outputPath);
        recoveryBackupPath = error.cleanupPreservePaths[0] ?? '';
        assert.ok(recoveryBackupPath);
        return true;
      },
    );

    assert.strictEqual(await readFile(requireValue(outputs[0]).outputPath, 'utf8'), 'external change after commit');
    assert.strictEqual(await readFile(requireValue(outputs[1]).outputPath, 'utf8'), 'old-second');
    assert.strictEqual(await readFile(recoveryBackupPath, 'utf8'), 'old-first');
  });

  it('競合判断中に出力が外部変更された場合はoverwriteを開始せず「changed before overwrite」エラーを返し、変更後の内容を保持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'new');
    await writeFixture(outputPath, 'old');

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath }], {
        resolveConflicts: async () => {
          await writeFile(outputPath, 'changed while dialog was open');
          return 'overwrite';
        },
      }),
      /changed before overwrite/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'changed while dialog was open');
  });

  it('workspace内の既存ファイルを指すsymlinkを出力先としてoverwriteしようとした場合は、link自体をregular fileへ置換せず拒否してlink先の内容も維持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath.path, '.graphics-workbench', 'result.pdf');
    const targetPath = path.join(workspacePath.path, 'target.pdf');
    const outputPath = path.join(workspacePath.path, 'link.pdf');
    await writeFixture(stagedOutputPath, 'converted');
    await writeFixture(targetPath, 'original target');
    await symlink(targetPath, outputPath);

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path }], {
        resolveConflicts: async () => 'overwrite',
      }),
      /Symbolic link output cannot be replaced safely/,
    );

    assert.strictEqual((await lstat(outputPath)).isSymbolicLink(), true);
    assert.strictEqual(await readFile(targetPath, 'utf8'), 'original target');
  });

  it('新規出力のstaged hash中に親directoryがworkspace外へのsymlinkへ差し替えられた場合は、境界外へ変換結果を作成せずcommitを拒否する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-parent-race-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-parent-race-outside-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    const outputDirectory = path.join(workspacePath.path, 'outputs');
    const displacedDirectory = path.join(workspacePath.path, 'outputs-before-swap');
    const outputPath = path.join(outputDirectory, 'result.pdf');
    const outsideOutputPath = path.join(outsidePath.path, 'result.pdf');
    await writeFixture(stagedOutputPath, '');
    await truncate(stagedOutputPath, 128 * 1024 * 1024);
    await mkdir(outputDirectory);
    let swapPromise: Promise<void> | undefined;

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath }], {
        outputChannel: {
          appendLine: (line) => {
            if (line.includes('conflict decision') && swapPromise === undefined) {
              swapPromise = new Promise((resolve) => setTimeout(resolve, 20)).then(async () => {
                await rename(outputDirectory, displacedDirectory);
                await symlink(outsidePath.path, outputDirectory);
              });
            }
          },
        },
      }),
      /outside the workspace|replaced during commit/,
    );

    assert.ok(swapPromise, '親directoryの差し替えが実行されたこと');
    await swapPromise;
    await assert.rejects(access(outsideOutputPath));
  });

  it('競合判断後の上書き前バックアップ作成中に既存出力が外部編集され、バックアップにも編集後内容がコピーされた場合は、競合表示前のSHA-256との不一致でcommitを中止して外部編集後の内容を保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'converted');
    await writeFixture(outputPath, 'original');
    let backupStarted = false;

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath }], {
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          if (!backupStarted) {
            backupStarted = true;
            await writeFile(outputPath, 'external edit during backup');
          }
          await copyFile(source, destination, flags);
        },
      }),
      /changed while creating overwrite backup/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'external edit during backup');
  });

  it('上書き用の一時ファイルへ変換結果をコピーした直後に既存出力が外部編集された場合は、最終置換前の再検証で中止して外部編集後の内容を保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'converted');
    await writeFixture(outputPath, 'original');
    let copyCount = 0;

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath }], {
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          await copyFile(source, destination, flags);
          copyCount += 1;
          if (copyCount === 2) {
            await writeFile(outputPath, 'external edit during temporary copy');
          }
        },
      }),
      /changed before atomic replacement/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'external edit during temporary copy');
  });

  it('上書き用の一時ファイルへのコピーが既存出力の外部編集後に失敗した場合は、まだ最終出力を変更していないため前回内容を復元せず外部編集後の内容を保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'sample.pdf');
    await writeFixture(stagedOutputPath, 'converted');
    await writeFixture(outputPath, 'original');
    let copyCount = 0;

    await assert.rejects(
      commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath }], {
        resolveConflicts: async () => 'overwrite',
        copyFile: async (source, destination, flags) => {
          await copyFile(source, destination, flags);
          copyCount += 1;
          if (copyCount === 2) {
            await writeFile(outputPath, 'external edit before temporary copy failure');
            throw new Error('injected temporary copy failure');
          }
        },
      }),
      /injected temporary copy failure/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'external edit before temporary copy failure');
  });

  it('新規出力のrollbackは対象の出力ファイルだけを削除し、workspace内の無関係なファイル（unrelated.txt）は残す', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-commit-test-'));
    const stagedOutputPath = path.join(workspacePath.path, '.graphics-workbench', 'result.pdf');
    const outputPath = path.join(workspacePath.path, 'sample.pdf');
    const unrelatedPath = path.join(workspacePath.path, 'unrelated.txt');
    await mkdir(path.dirname(stagedOutputPath), { recursive: true });
    await mkdir(stagedOutputPath);
    await writeFixture(unrelatedPath, 'keep');

    await assert.rejects(commitStagedOutputs([{ stagedOutputPath, outputPath, workspacePath: workspacePath.path }]));

    assert.strictEqual(await readFile(unrelatedPath, 'utf8'), 'keep');
  });

  it('Safe Modeの「Do Not Overwrite」取消がOperationCancelledErrorとしてnameとmessageで確認できる', () => {
    const error = new OperationCancelledError('Do Not Overwrite');

    assert.strictEqual(error.name, 'OperationCancelledError');
    assert.match(error.message, /Do Not Overwrite/);
  });
});

async function writeFixture(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}
