import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from '../../support/helpers/pdf_document.js';

import { cropPdfFile, type CropPdfFileWriter } from '@graphics-workbench/core/pdf';
import {
  parseCropWorkerRequest,
  parseCropWorkerResult,
  runCropWorker,
  type CropWorkerChild,
} from '../../../src/adapters/crop/run_crop_worker.js';
import { operationPdfInputDirectory } from '../../support/helpers/fixture_paths.js';
import { RecordingOutputChannel } from '../../support/helpers/recording_output_channel.js';
import { assertWorkspaceChangesSince, captureWorkspaceSnapshot } from '../../support/helpers/workspace_snapshot.js';

const fixtureRunnerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../support/fixtures/crop_process_fixture_runner.js',
);

// mupdf re-serializes page boxes with limited float precision, so compare
// against the source within a small tolerance instead of exact equality.
function assertBoxEquals(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
  tolerance = 0.001,
): void {
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `x differs: ${actual.x} vs ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `y differs: ${actual.y} vs ${expected.y}`);
  assert.ok(
    Math.abs(actual.width - expected.width) <= tolerance,
    `width differs: ${actual.width} vs ${expected.width}`,
  );
  assert.ok(
    Math.abs(actual.height - expected.height) <= tolerance,
    `height differs: ${actual.height} vs ${expected.height}`,
  );
}

suite('Crop workerで単一リクエストを処理してIPCの結果を確定する', () => {
  suite('request/resultスキーマは余分なキーや不正な型を拒否する', () => {
    test('有効なcrop・inspectリクエストと結果を受け入れ、余分なキーや誤った型を拒否する', () => {
      const cropRequest = {
        type: 'crop' as const,
        request: createTestRequest('/workspace', '/workspace/staging/result.pdf'),
      };
      assert.deepStrictEqual(parseCropWorkerRequest(cropRequest), cropRequest);
      assert.throws(() => parseCropWorkerRequest({ ...cropRequest, extra: true }), /Invalid Crop worker request\./u);
      assert.throws(
        () =>
          parseCropWorkerRequest({
            type: 'crop',
            request: { ...createTestRequest('/workspace', '/workspace/staging/result.pdf'), sourcePath: 7 },
          }),
        /Invalid Crop worker request\./u,
      );
      assert.throws(
        () =>
          parseCropWorkerRequest({
            type: 'crop',
            request: {
              ...createTestRequest('/workspace', '/workspace/staging/result.pdf'),
              cropBox: { left: 1, bottom: 1, right: Number.NaN, top: 1 },
            },
          }),
        /Invalid Crop worker request\./u,
      );
      assert.throws(
        () =>
          parseCropWorkerRequest({
            type: 'crop',
            request: {
              ...createTestRequest('/workspace', '/workspace/staging/result.pdf'),
              target: { type: 'selected', pages: [] },
            },
          }),
        /Invalid Crop worker request\./u,
      );

      const inspectRequest = { type: 'inspect' as const, filePath: '/workspace/input.pdf' };
      assert.deepStrictEqual(parseCropWorkerRequest(inspectRequest), inspectRequest);
      assert.throws(() => parseCropWorkerRequest({ type: 'inspect', filePath: '' }), /Invalid Crop worker request\./u);
      assert.throws(
        () => parseCropWorkerRequest({ type: 'inspect', filePath: '/workspace/input.pdf', extra: true }),
        /Invalid Crop worker request\./u,
      );

      assert.deepStrictEqual(parseCropWorkerResult({ ok: true }), { ok: true, value: undefined });
      const metadata = {
        pageCount: 1,
        pages: [
          {
            page: 1,
            mediaBox: { x: 0, y: 0, width: 612, height: 792 },
            cropBox: { x: 0, y: 0, width: 612, height: 792 },
            rotation: 0,
          },
        ],
      };
      assert.deepStrictEqual(parseCropWorkerResult({ ok: true, value: metadata }), { ok: true, value: metadata });
      assert.deepStrictEqual(parseCropWorkerResult({ ok: false, error: 'failed' }), {
        ok: false,
        error: 'failed',
      });
      assert.throws(() => parseCropWorkerResult({ ok: true, secret: true }), /Invalid Crop worker result\./u);
      assert.throws(() => parseCropWorkerResult({ ok: false }), /Invalid Crop worker result\./u);
      assert.throws(
        () => parseCropWorkerResult({ ok: false, error: 'failed', secret: 'not-allowed' }),
        /Invalid Crop worker result\./u,
      );
      assert.throws(
        () =>
          parseCropWorkerResult({
            ok: true,
            value: {
              pageCount: 1,
              pages: [
                {
                  page: 1,
                  mediaBox: { x: 0, y: 0, width: 612, height: 792 },
                  cropBox: { x: 0, y: 0, width: 612, height: 792 },
                  rotation: 45,
                },
              ],
            },
          }),
        /Invalid Crop worker result\./u,
      );
    });
  });

  suite('実workerプロセスと実ファイルでPDFのCropBoxだけを更新して作業出力へ書き出す', () => {
    test('multilingual-text.pdfを全ページCropして一時作業ディレクトリのresult.pdfへ出力すると、各ページのCropBoxを更新するだけでMediaBox・隣接ファイルを変更しない', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'multilingual-text.pdf');
        const adjacentPath = path.join(workspacePath, 'notes.txt');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
        await writeFile(adjacentPath, 'keep this file unchanged');

        const before = await captureWorkspaceSnapshot(workspacePath);
        const logs = new RecordingOutputChannel();
        const cropBox = { left: 20, bottom: 30, right: 200, top: 280 };

        const result = await runCropWorker(
          { type: 'crop', request: { sourcePath, stagedOutputPath, cropBox, target: { type: 'all' } } },
          undefined,
          { outputChannel: logs },
        );
        assert.strictEqual(result, undefined);

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {
          created: [path.join('staging', 'result.pdf')],
        });
        const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
        const outputDocument = await PDFDocument.load(await readFile(stagedOutputPath));
        assert.strictEqual(outputDocument.getPageCount(), 2);
        for (const [index, page] of outputDocument.getPages().entries()) {
          const sourceBox = sourceDocument.getPage(index)?.getMediaBox();
          assert.ok(sourceBox);
          assertBoxEquals(page.getMediaBox(), sourceBox);
          assertBoxEquals(page.getCropBox(), {
            x: cropBox.left,
            y: cropBox.bottom,
            width: cropBox.right - cropBox.left,
            height: cropBox.top - cropBox.bottom,
          });
        }

        assertLogSequence(logs.lines, [
          'operation-started',
          'child-spawned',
          'request-sent',
          'result-received',
          'process-completed',
        ]);
        assertNoLog(logs, /operation-failed|operation-cancelled|protocol|secret|password/iu);
      });
    });

    test('multi-page-mixed-content.pdfの先頭ページだけをCropすると、対象外ページのCropBoxと全ページのMediaBoxを維持したまま一時作業ディレクトリへ出力する', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'multi-page-mixed-content.pdf');
        const adjacentPath = path.join(workspacePath, 'adjacent.txt');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'mixed-result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multi-page-mixed-content.pdf'), sourcePath);
        await writeFile(adjacentPath, 'unchanged');

        const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
        const before = await captureWorkspaceSnapshot(workspacePath);
        const cropBox = { left: 10, bottom: 10, right: 200, top: 200 };
        const result = await runCropWorker({
          type: 'crop',
          request: { sourcePath, stagedOutputPath, cropBox, target: { type: 'selected', pages: [1] } },
        });
        assert.strictEqual(result, undefined);

        const outputDocument = await PDFDocument.load(await readFile(stagedOutputPath));
        assert.strictEqual(outputDocument.getPageCount(), sourceDocument.getPageCount());
        for (const [index, page] of outputDocument.getPages().entries()) {
          const sourceBox = sourceDocument.getPage(index);
          assert.ok(sourceBox);
          assertBoxEquals(page.getMediaBox(), sourceBox.getMediaBox());
          if (index === 0) {
            assertBoxEquals(page.getCropBox(), {
              x: cropBox.left,
              y: cropBox.bottom,
              width: cropBox.right - cropBox.left,
              height: cropBox.top - cropBox.bottom,
            });
          } else {
            assertBoxEquals(page.getCropBox(), sourceBox.getCropBox());
          }
        }

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {
          created: [path.join('staging', 'mixed-result.pdf')],
        });
      });
    });

    test('壊れたPDFを実workerへ渡すと、子の失敗結果を記録して処理失敗になり、一時出力も周辺ファイルも作成しない', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'invalid.pdf');
        const adjacentPath = path.join(workspacePath, 'notes.txt');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, '../../invalid/pdf/not-a-pdf.pdf'), sourcePath);
        await writeFile(adjacentPath, 'keep');

        const before = await captureWorkspaceSnapshot(workspacePath);
        const logs = new RecordingOutputChannel();
        await assert.rejects(
          runCropWorker(
            {
              type: 'crop',
              request: {
                sourcePath,
                stagedOutputPath,
                cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
                target: { type: 'all' },
              },
            },
            undefined,
            { outputChannel: logs },
          ),
          /PDF|parse|invalid/iu,
        );

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {});
        assert.ok(logs.hasLine('result-received'));
        assert.ok(logs.hasLine('operation-failed'));
        assertNoLog(logs, /process-completed|operation-completed|secret content/iu);
      });
    });

    test('存在しない入力ファイルを実filesystemで指定すると、子の失敗結果を記録してENOENTで失敗し、出力ファイルを作成しない', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'missing.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();

        await assert.rejects(
          runCropWorker(
            {
              type: 'crop',
              request: {
                sourcePath,
                stagedOutputPath,
                cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
                target: { type: 'all' },
              },
            },
            undefined,
            { outputChannel: logs },
          ),
          /ENOENT|no such file|not found/iu,
        );
        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince({ files: new Map() }, after, {});
        assert.ok(logs.hasLine('operation-failed'));
        assertNoLog(logs, /process-completed/iu);
      });
    });

    test('作業出力先pathが既にdirectoryとして存在する場合は、一時ファイル出力を残さずrename失敗として扱う', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'source.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
        await mkdir(stagedOutputPath);

        const before = await captureWorkspaceSnapshot(workspacePath);
        await assert.rejects(
          runCropWorker({
            type: 'crop',
            request: {
              sourcePath,
              stagedOutputPath,
              cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
              target: { type: 'all' },
            },
          }),
          /EISDIR|directory|rename/iu,
        );

        const after = await captureWorkspaceSnapshot(workspacePath);
        assert.deepStrictEqual([...after.files.keys()].toSorted(), [...before.files.keys()].toSorted());
        assert.ok(!(await pathExists(`${stagedOutputPath}.partial`)));
      });
    });

    test('実workerでmultilingual-text.pdfをinspectするとpageCountとページgeometryを返す', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'input.pdf');
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);

        const metadata = await runCropWorker({ type: 'inspect', filePath: sourcePath });
        assert.ok(metadata !== undefined);
        assert.strictEqual(metadata.pageCount, 2);
        assert.strictEqual(metadata.pages.length, 2);
        for (const [index, page] of metadata.pages.entries()) {
          assert.strictEqual(page.page, index + 1);
          assert.ok(page.mediaBox.width > 0);
          assert.ok(page.mediaBox.height > 0);
          assert.ok(page.cropBox.width > 0);
          assert.ok(page.cropBox.height > 0);
        }
      });
    });

    test('hang-with-descendant fixture実行中にAbortSignalでcancelすると、子プロセスと子孫をまとめて終了させてOperationCancelledErrorで止まり、一時出力を作成しない', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const pidFile = path.join(workspacePath, 'descendant.pid');
        const controller = new AbortController();
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();
        const operation = runCropWorker(
          { type: 'crop', request: createTestRequest(workspacePath, stagedOutputPath) },
          controller.signal,
          {
            workerPath: fixtureRunnerPath,
            launcher: createFixtureLauncher('hang-with-descendant', pidFile),
            outputChannel: logs,
          },
        );
        const descendantPid = await waitForPid(pidFile);
        controller.abort();

        await assert.rejects(operation, { name: 'OperationCancelledError' });
        await waitForProcessExit(descendantPid);
        assert.ok(logs.hasLine('operation-cancelled'));
        assertNoLog(logs, /result-received|process-completed/iu);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });

    test('request受信後にexit code 23で終了するfixtureは異常終了として扱い、一時出力を作成せず失敗する', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();

        await assert.rejects(
          runCropWorker({ type: 'crop', request: createTestRequest(workspacePath, stagedOutputPath) }, undefined, {
            workerPath: fixtureRunnerPath,
            launcher: createFixtureLauncher('exit-23'),
            outputChannel: logs,
          }),
          /exited without a result/iu,
        );
        assert.ok(logs.hasLine('operation-failed'));
        assertNoLog(logs, /result-received|process-completed/iu);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });
  });

  suite('Fakeの子プロセスで、親側がIPC結果とキャンセル・異常終了の判定を行う', () => {
    test('有効なok:true結果を受信した場合は成功で確定し、message/exit監視を解放する', async () => {
      const child = new FakeCropWorkerChild();
      const logs = new RecordingOutputChannel();
      const operation = runCropWorker(
        { type: 'crop', request: createTestRequest('/workspace', '/workspace/staging/result.pdf') },
        undefined,
        { launcher: () => child, outputChannel: logs },
      );
      child.emitMessage({ ok: true });

      assert.strictEqual(await operation, undefined);
      assert.strictEqual(child.sentMessages.length, 1);
      assert.strictEqual(child.listenerCount('message'), 0);
      assert.strictEqual(child.listenerCount('exit'), 0);
      assert.ok(logs.hasLine('process-completed'));
      assertNoLog(logs, /operation-failed|operation-cancelled/iu);
    });

    test('ok:false結果は子のエラーメッセージで失敗する', async () => {
      const child = new FakeCropWorkerChild();
      const operation = runCropWorker({ type: 'inspect', filePath: '/workspace/input.pdf' }, undefined, {
        launcher: () => child,
      });
      child.emitMessage({ ok: false, error: 'child failed' });

      await assert.rejects(operation, /child failed/iu);
    });

    test('inspectのok:true結果はメタデータをvalueとして返す', async () => {
      const child = new FakeCropWorkerChild();
      const metadata = {
        pageCount: 1,
        pages: [
          {
            page: 1,
            mediaBox: { x: 0, y: 0, width: 612, height: 792 },
            cropBox: { x: 0, y: 0, width: 612, height: 792 },
            rotation: 0,
          },
        ],
      };
      const operation = runCropWorker({ type: 'inspect', filePath: '/workspace/input.pdf' }, undefined, {
        launcher: () => child,
      });
      child.emitMessage({ ok: true, value: metadata });

      assert.deepStrictEqual(await operation, metadata);
    });

    test('プロセス起動が失敗した場合はrequest送信前に1回だけchild-spawn-failedを記録して失敗する', async () => {
      const logs = new RecordingOutputChannel();
      let launcherCalls = 0;
      await assert.rejects(
        runCropWorker({ type: 'inspect', filePath: '/workspace/input.pdf' }, undefined, {
          launcher: () => {
            launcherCalls += 1;
            throw new Error('spawn crop worker ENOENT');
          },
          outputChannel: logs,
        }),
        /ENOENT/iu,
      );
      assert.strictEqual(launcherCalls, 1);
      assert.ok(logs.hasLine('child-spawn-failed'));
      assertNoLog(logs, /request-sent|result-received|process-completed|operation-cancelled/iu);
    });

    test('childのerrorイベントを受けた場合はそのエラーで失敗する', async () => {
      const child = new FakeCropWorkerChild();
      const operation = runCropWorker({ type: 'inspect', filePath: '/workspace/input.pdf' }, undefined, {
        launcher: () => child,
      });
      child.emitError(new Error('child crashed'));

      await assert.rejects(operation, /child crashed/iu);
    });

    test('結果メッセージなしでexitした場合はexited without a resultとして失敗する', async () => {
      const child = new FakeCropWorkerChild();
      const operation = runCropWorker(
        { type: 'crop', request: createTestRequest('/workspace', '/workspace/staging/result.pdf') },
        undefined,
        { launcher: () => child },
      );
      child.emitExit(23, null);

      await assert.rejects(operation, /exited without a result/iu);
    });

    for (const [name, message] of invalidResultMessageCases()) {
      test(`不正な結果メッセージ（${name}）を受信した場合はprotocol errorとして失敗し、監視を解放して秘密payloadをログへ出さない`, async () => {
        const child = new FakeCropWorkerChild();
        const logs = new RecordingOutputChannel();
        const operation = runCropWorker(
          { type: 'crop', request: createTestRequest('/workspace', '/workspace/staging/result.pdf') },
          undefined,
          { launcher: () => child, outputChannel: logs },
        );
        child.emitMessage(message);

        await assert.rejects(operation, /protocol error/iu);
        assertNoLog(logs, /secret pdf|password|full payload/iu);
        assert.strictEqual(child.listenerCount('message'), 0);
        assert.strictEqual(child.listenerCount('exit'), 0);
      });
    }

    test('実行中にAbortSignalでcancelするとterminateProcessTreeを呼び出してOperationCancelledErrorで失敗し、監視を解放する', async () => {
      const child = new FakeCropWorkerChild();
      const controller = new AbortController();
      const logs = new RecordingOutputChannel();
      const operation = runCropWorker(
        { type: 'crop', request: createTestRequest('/workspace', '/workspace/staging/result.pdf') },
        controller.signal,
        { launcher: () => child, outputChannel: logs },
      );
      controller.abort();

      await assert.rejects(operation, { name: 'OperationCancelledError' });
      assert.ok(child.killCalls >= 1);
      assert.ok(logs.hasLine('operation-cancelled'));
      assert.strictEqual(child.listenerCount('message'), 0);
      assert.strictEqual(child.listenerCount('exit'), 0);
      assertNoLog(logs, /result-received|process-completed/iu);
    });

    test('起動前にAbortSignalがcancel済みの場合はプロセスを起動せずOperationCancelledErrorで失敗する', async () => {
      const controller = new AbortController();
      controller.abort();
      let launcherCalls = 0;

      await assert.rejects(
        runCropWorker({ type: 'inspect', filePath: '/workspace/input.pdf' }, controller.signal, {
          launcher: () => {
            launcherCalls += 1;
            return new FakeCropWorkerChild();
          },
        }),
        { name: 'OperationCancelledError' },
      );
      assert.strictEqual(launcherCalls, 0);
    });
  });

  suite('Crop処理のファイル書き込みを差し替えて失敗時の後始末を検証する', () => {
    test('crop結果のPDF書き出しがディスク不足（ENOSPC）で失敗すると、出力先へ置き換えせず一時ファイルを削除して失敗する', async () => {
      // Real:
      // - 実mupdfによるsource PDFのload/save
      //
      // Fixture / Fake / Stub / Mock:
      // - writer.writeFileだけをENOSPC Stubへ置換
      //
      // Failure trigger:
      // - writeFileがENOSPCを返す
      //
      // Guaranteed:
      // - ENOSPCが握りつぶされず、renameされず、temporary outputがcleanupされる
      //
      // Not covered:
      // - このtestでは実worker processや実ディスク容量を保証しない
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'source.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
        const removedPaths: string[] = [];
        let renameCalled = false;
        const writer: CropPdfFileWriter = {
          writeFile: async () => {
            throw new Error('No space left on device');
          },
          rename: async () => {
            renameCalled = true;
          },
          remove: async (filePath) => {
            removedPaths.push(filePath);
          },
        };

        await assert.rejects(
          cropPdfFile(
            {
              sourcePath,
              stagedOutputPath,
              cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
              target: { type: 'all' },
            },
            writer,
          ),
          /No space left on device/iu,
        );
        assert.strictEqual(renameCalled, false);
        assert.deepStrictEqual(removedPaths, [`${stagedOutputPath}.partial`]);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });
  });
});

class FakeCropWorkerChild extends EventEmitter {
  readonly pid = 12345;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly sentMessages: unknown[] = [];
  killCalls = 0;

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killCalls += 1;
    return true;
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sentMessages.push(message);
    callback?.(null);
    return true;
  }

  emitMessage(message: unknown): void {
    this.emit('message', message);
  }

  emitError(error: Error): void {
    this.emit('error', error);
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }
}

function createTestRequest(workspacePath: string, stagedOutputPath: string) {
  return {
    sourcePath: path.join(workspacePath, 'input.pdf'),
    stagedOutputPath,
    cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
    target: { type: 'all' as const },
  };
}

function invalidResultMessageCases(): readonly [string, unknown][] {
  return [
    ['null', null],
    ['unknown shape', { type: 'failure', error: 'secret pdf content' }],
    ['extra key', { ok: true, secret: 'secret pdf content' }],
    ['missing error', { ok: false }],
    ['wrong ok type', { ok: 1, value: undefined }],
  ];
}

function createFixtureLauncher(behavior: string, pidFile?: string): (workerPath: string) => CropWorkerChild {
  return (workerPath) =>
    fork(workerPath, [], {
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        CROP_PROCESS_FIXTURE_BEHAVIOR: behavior,
        ...(pidFile === undefined ? {} : { CROP_PROCESS_FIXTURE_PID_FILE: pidFile }),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
}

function assertLogSequence(lines: readonly string[], events: readonly string[]): void {
  let lastIndex = -1;
  for (const event of events) {
    // oxlint-disable-next-line typescript/no-loop-func -- findIndex runs synchronously in this iteration, so the closure is safe.
    const index = lines.findIndex((line, candidateIndex) => candidateIndex > lastIndex && line.includes(event));
    assert.notStrictEqual(index, -1, `Expected log event after index ${lastIndex}: ${event}\n${lines.join('\n')}`);
    lastIndex = index;
  }
}

function assertNoLog(logs: RecordingOutputChannel, pattern: RegExp): void {
  assert.equal(
    logs.lines.some((line) => pattern.test(line)),
    false,
    `Unexpected log line:\n${logs.lines.join('\n')}`,
  );
}

async function withTemporaryWorkspace(callback: (workspacePath: string) => Promise<void>): Promise<void> {
  await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-crop-worker-'));
  return await callback(workspacePath.path);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitForPid(pidFile: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const pid = Math.trunc(Number(await readFile(pidFile, 'utf8')));
      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    } catch {
      // The fixture writes its pid after the message is received.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fixture pid file: ${pidFile}`);
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isProcessNotFoundError(error);
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!(await isProcessAlive(pid))) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fixture descendant process to exit: ${pid}`);
}

function isProcessNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ESRCH' || error.code === 'EINVAL');
}
