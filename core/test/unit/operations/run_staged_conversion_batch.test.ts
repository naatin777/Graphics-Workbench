import assert from 'node:assert/strict';
import { access, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runStagedConversionBatch } from '@graphics-workbench/core/runtime';

describe('変換出力を一時領域へ書き出し、全件成功後に最終出力へ反映し、失敗・中断時は一時領域を掃除する一括処理', () => {
  it('成功時は一時出力を最終出力へ反映した後も、反映前の一時出力を保持したまま最終出力にも同じ内容を置く', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-'));
    const outputPath = path.join(workspacePath.path, 'result.png');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'testdata-raster', 'run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.png');

    const outputs = await runStagedConversionBatch({
      inputs: [{ workspacePath: workspacePath.path }],
      operationName: 'testdata-raster',
      runtime: {},
      runId: 'run',
      stage: async () => {
        await mkdir(stagingRootPath, { recursive: true });
        await writeFile(stagedOutputPath, 'raster result');
        return { stagedOutputPath, outputPath, workspacePath: workspacePath.path, stagingRootPath };
      },
    });

    assert.strictEqual(outputs[0]?.outputPath, outputPath);
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'raster result');
    assert.strictEqual(await readFile(stagedOutputPath, 'utf8'), 'raster result');
  });

  it('変換が失敗した場合は該当処理の一時作業ディレクトリを削除して最終出力を作らず、workspace外の既存ファイルは保持する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-outside-'));
    const outputPath = path.join(workspacePath.path, 'result.png');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'testdata-raster', 'failed-run');
    const stagedOutputPath = path.join(stagingRootPath, 'result.png');
    const outsideFilePath = path.join(outsidePath.path, 'keep.txt');

    await writeFile(outsideFilePath, 'keep');

    await assert.rejects(
      runStagedConversionBatch({
        inputs: [{ workspacePath: workspacePath.path }],
        operationName: 'testdata-raster',
        runtime: {},
        runId: 'failed-run',
        stage: async () => {
          await mkdir(stagingRootPath, { recursive: true });
          await writeFile(stagedOutputPath, 'partial result');
          throw new Error('injected stage failure');
        },
      }),
      /injected stage failure/,
    );

    await assert.rejects(access(stagedOutputPath));
    await assert.rejects(access(outputPath));
    assert.strictEqual(await readFile(outsideFilePath, 'utf8'), 'keep');
  });

  it('安全でないrunId（../../src）はstage開始前にUnsafe runIdで拒否し、workspace内の保護ファイルを削除しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-'));
    const protectedDirectory = path.join(workspacePath.path, 'src');
    const protectedFile = path.join(protectedDirectory, 'keep.txt');

    await mkdir(protectedDirectory, { recursive: true });
    await writeFile(protectedFile, 'keep');

    await assert.rejects(
      runStagedConversionBatch({
        inputs: [{ workspacePath: workspacePath.path }],
        operationName: 'testdata-raster',
        runtime: {},
        runId: '../../src',
        stage: async () => {
          throw new Error('stage must not start');
        },
      }),
      /Unsafe runId/iu,
    );

    assert.strictEqual(await readFile(protectedFile, 'utf8'), 'keep');
  });

  it('1つ目のstageが失敗しても実行中2つ目のstageの完了を待ってからcleanupし、3つ目の待機stageは開始しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'testdata-raster', 'abort-run');
    let resolveSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    let thirdStarted = false;
    let resolveSecondStopped!: () => void;
    const secondStopped = new Promise<void>((resolve) => {
      resolveSecondStopped = resolve;
    });
    let batch: Promise<unknown> | undefined;

    try {
      batch = runStagedConversionBatch({
        inputs: [
          { workspacePath: workspacePath.path },
          { workspacePath: workspacePath.path },
          { workspacePath: workspacePath.path },
        ],
        operationName: 'testdata-raster',
        runtime: {},
        runId: 'abort-run',
        stage: async (_item, index, _runId, runtime) => {
          await mkdir(stagingRootPath, { recursive: true });

          if (index === 0) {
            await writeFile(path.join(stagingRootPath, 'first'), 'partial');
            throw new Error('injected stage failure');
          }

          if (index === 1) {
            // 1つ目のstageの失敗（abort）を確認してから自分の失敗を発生させる。
            // これによりroot causeが「時間的に最初の失敗」であることを決定的にする。
            // abortはstage0のI/O完了後に発火し得るため、listenerは最初に登録する。
            const siblingFailed = new Promise<void>((resolve) => {
              runtime.signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            await writeFile(path.join(stagingRootPath, 'second'), 'in progress');
            resolveSecondStarted();
            await siblingFailed;
            resolveSecondStopped();
            throw new Error('second stage stopped');
          }

          thirdStarted = true;
          throw new Error('queued stage should not start');
        },
      });

      await Promise.race([
        secondStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('second stage did not start')), 1000),
        ),
      ]);
      assert.strictEqual(thirdStarted, false);
      await assert.doesNotReject(access(path.join(stagingRootPath, 'second')));
      await Promise.race([
        secondStopped,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('second stage did not stop after sibling failure')), 1000),
        ),
      ]);

      await assert.rejects(batch, /injected stage failure/);
      await assert.rejects(access(stagingRootPath));
    } finally {
      await batch?.catch(() => undefined);
    }
  });

  it('callerがabortしても実行中のstageがsettleするまでcleanupせず、未開始の変換は開始せずAbortErrorで終了後に一時作業ディレクトリを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-staged-batch-'));
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'testdata-raster', 'caller-abort-run');
    const abortController = new AbortController();
    let startedStages = 0;
    let queuedStageStarted = false;
    let resolveBothStarted!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      resolveBothStarted = resolve;
    });
    let releaseStages!: () => void;
    const stagesReleased = new Promise<void>((resolve) => {
      releaseStages = resolve;
    });
    let batch: Promise<unknown> | undefined;

    try {
      batch = runStagedConversionBatch({
        inputs: [
          { workspacePath: workspacePath.path },
          { workspacePath: workspacePath.path },
          { workspacePath: workspacePath.path },
        ],
        operationName: 'testdata-raster',
        runId: 'caller-abort-run',
        runtime: { signal: abortController.signal },
        stage: async (_item, index, _runId, runtime) => {
          if (index >= 2) {
            queuedStageStarted = true;
            throw new Error('queued stage should not start');
          }

          await mkdir(stagingRootPath, { recursive: true });
          await writeFile(path.join(stagingRootPath, `item-${index}`), 'in progress');
          startedStages++;
          if (startedStages === 2) {
            resolveBothStarted();
          }

          await stagesReleased;
          runtime.signal?.throwIfAborted();
          throw new Error('delayed sibling stage should stop');
        },
      });

      await Promise.race([
        bothStarted,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('both stages did not start')), 1000),
        ),
      ]);
      abortController.abort();

      // 2つのslotは両方ともreleaseStagesまで占有されるため、待機中stageは
      // abortとは無関係に開始不可能で確定する。
      assert.strictEqual(queuedStageStarted, false);
      await assert.doesNotReject(access(path.join(stagingRootPath, 'item-1')));

      releaseStages();
      await assert.rejects(batch, { name: 'AbortError' });
      await assert.rejects(access(stagingRootPath));
    } finally {
      releaseStages();
      await batch?.catch(() => undefined);
    }
  });
});
