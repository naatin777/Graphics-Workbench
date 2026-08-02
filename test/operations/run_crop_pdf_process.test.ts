import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';

import { cropPdfFile, type CropPdfFileWriter } from '../../src/operations/pdf/crop_pdf_core.js';
import {
  createCropProcessChild,
  runCropPdfProcess,
  type CropProcessChild,
} from '../../src/operations/pdf/run_crop_pdf_process.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { RecordingOutputChannel } from '../helpers/recording_output_channel.js';
import { assertWorkspaceChangesSince, captureWorkspaceSnapshot } from '../helpers/workspace_snapshot.js';

const fixtureRunnerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/crop_process_fixture_runner.js',
);

suite('Crop PDF child process', () => {
  suite('Real child process・real filesystem・real pdf-lib', () => {
    test('multilingual-text.pdfをstaging/result.pdfへ全ページCropすると、CropBoxだけを更新し隣接ファイルを変更しない', async () => {
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

        await runCropPdfProcess({ sourcePath, stagedOutputPath, cropBox, target: { type: 'all' } }, undefined, {
          outputChannel: logs,
          requestId: 'real-success',
        });

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {
          created: [path.join('staging', 'result.pdf')],
        });
        const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
        const outputDocument = await PDFDocument.load(await readFile(stagedOutputPath));
        assert.strictEqual(outputDocument.getPageCount(), 2);
        for (const [index, page] of outputDocument.getPages().entries()) {
          assert.deepStrictEqual(page.getMediaBox(), sourceDocument.getPage(index)?.getMediaBox());
          assert.deepStrictEqual(page.getCropBox(), {
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
          'child-started',
          'child-success-received',
          'child-disconnected',
          'child-exited',
          'process-completed',
        ]);
        assert.ok(logs.hasLine(/child-exited .*code=0/iu));
        assertNoLog(logs, /operation-failed|operation-cancelled|protocol-error|secret|password/iu);
      });
    });

    test('multi-page-mixed-content.pdfの1ページだけをCropすると、対象外ページのCropBoxと全MediaBoxを維持する', async () => {
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
        await runCropPdfProcess({ sourcePath, stagedOutputPath, cropBox, target: { type: 'selected', pages: [1] } });

        const outputDocument = await PDFDocument.load(await readFile(stagedOutputPath));
        assert.strictEqual(outputDocument.getPageCount(), sourceDocument.getPageCount());
        for (const [index, page] of outputDocument.getPages().entries()) {
          assert.deepStrictEqual(page.getMediaBox(), sourceDocument.getPage(index)?.getMediaBox());
          if (index === 0) {
            assert.deepStrictEqual(page.getCropBox(), {
              x: cropBox.left,
              y: cropBox.bottom,
              width: cropBox.right - cropBox.left,
              height: cropBox.top - cropBox.bottom,
            });
          } else {
            assert.deepStrictEqual(page.getCropBox(), sourceDocument.getPage(index)?.getCropBox());
          }
        }

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {
          created: [path.join('staging', 'mixed-result.pdf')],
        });
      });
    });

    test('壊れたPDFを実childへ渡すと、staging出力と周辺ファイルを残さず失敗ログだけを記録する', async () => {
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
          runCropPdfProcess(
            {
              sourcePath,
              stagedOutputPath,
              cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
              target: { type: 'all' },
            },
            undefined,
            { outputChannel: logs, requestId: 'real-invalid' },
          ),
          /PDF|parse|invalid/iu,
        );

        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince(before, after, {});
        assert.ok(logs.hasLine('child-failure-received'));
        assert.ok(logs.hasLine('operation-failed'));
        assertNoLog(logs, /child-success-received|process-completed|operation-completed|secret content/iu);
      });
    });

    test('存在しない入力pathを実filesystemで指定すると、出力を作らず診断可能な失敗になる', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'missing.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();

        await assert.rejects(
          runCropPdfProcess(
            {
              sourcePath,
              stagedOutputPath,
              cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
              target: { type: 'all' },
            },
            undefined,
            { outputChannel: logs, requestId: 'real-missing' },
          ),
          /ENOENT|no such file|not found/iu,
        );
        const after = await captureWorkspaceSnapshot(workspacePath);
        assertWorkspaceChangesSince({ files: new Map() }, after, {});
        assert.ok(logs.hasLine('child-failure-received'));
        assertNoLog(logs, /child-success-received|process-completed/iu);
      });
    });

    test('実pathの書き込み先がdirectoryの場合、partial outputを残さず失敗する', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'source.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
        await mkdir(stagedOutputPath);

        const before = await captureWorkspaceSnapshot(workspacePath);
        await assert.rejects(
          runCropPdfProcess({
            sourcePath,
            stagedOutputPath,
            cropBox: { left: 20, bottom: 30, right: 200, top: 280 },
            target: { type: 'all' },
          }),
          /EISDIR|directory|rename/iu,
        );

        const after = await captureWorkspaceSnapshot(workspacePath);
        assert.deepStrictEqual([...after.files.keys()].toSorted(), [...before.files.keys()].toSorted());
        assert.ok(!(await pathExists(`${stagedOutputPath}.partial`)));
      });
    });

    test('hang-with-descendant fixtureをAbortSignalでcancelするとchild process treeを終了する', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const pidFile = path.join(workspacePath, 'descendant.pid');
        const controller = new AbortController();
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();
        const operation = runCropPdfProcess(
          {
            sourcePath: path.join(workspacePath, 'input.pdf'),
            stagedOutputPath,
            cropBox: { left: 1, bottom: 1, right: 100, top: 100 },
            target: { type: 'all' },
          },
          controller.signal,
          {
            runnerPath: fixtureRunnerPath,
            launcher: createFixtureLauncher('hang-with-descendant', pidFile),
            outputChannel: logs,
            requestId: 'real-cancel',
          },
        );
        const descendantPid = await waitForPid(pidFile);
        controller.abort();

        await assert.rejects(operation, { name: 'OperationCancelledError' });
        assert.strictEqual(await isProcessAlive(descendantPid), false);
        assert.ok(logs.hasLine('cancellation-requested'));
        assert.ok(logs.hasLine('process-termination-requested'));
        assert.ok(logs.hasLine('child-exited'));
        assert.ok(logs.hasLine('operation-cancelled'));
        assertNoLog(logs, /child-success-received|process-completed/iu);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });
  });

  suite('Fixture runner・real OS終了処理', () => {
    test('request受信後にexit(23)するfixtureは異常exitとして扱いcommitへ進めない', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();

        await assert.rejects(
          runCropPdfProcess(createTestRequest(workspacePath, stagedOutputPath), undefined, {
            runnerPath: fixtureRunnerPath,
            launcher: createFixtureLauncher('exit-23'),
            outputChannel: logs,
            requestId: 'fixture-exit-23',
          }),
          /code 23/iu,
        );
        assert.ok(logs.hasLine('child-started'));
        assert.ok(logs.hasLine(/child-exited .*code=23/iu));
        assertNoLog(logs, /child-success-received|process-completed/iu);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });

    test('success通知後にexit(1)するfixtureはsuccess扱いせず異常終了を返す', async () => {
      await withTemporaryWorkspace(async (workspacePath) => {
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        const logs = new RecordingOutputChannel();

        await assert.rejects(
          runCropPdfProcess(createTestRequest(workspacePath, stagedOutputPath), undefined, {
            runnerPath: fixtureRunnerPath,
            launcher: createFixtureLauncher('success-then-exit-1'),
            outputChannel: logs,
            requestId: 'fixture-success-exit-1',
          }),
          /reported success but exited with code 1/iu,
        );
        assert.ok(logs.hasLine('child-success-received'));
        assert.ok(logs.hasLine(/child-exited .*code=1/iu));
        assertNoLog(logs, /process-completed|operation-completed/iu);
        assert.strictEqual(await pathExists(stagedOutputPath), false);
      });
    });
  });

  suite('FakeChildProcessによる親側ライフサイクル', () => {
    // Real:
    // - 親のIPC state machineとAbortSignal
    //
    // Fixture / Fake / Stub / Mock:
    // - FakeChildProcessはterminate要求を記録するが、OS processは起動しない
    //
    // Failure trigger:
    // - 不正IPC、二重通知、success後の異常exit、terminate後の無通知
    //
    // Guaranteed:
    // - 親が不正な完了通知を成功扱いせず、listenerをcleanupし、watchdogで待機を終える
    //
    // Not covered:
    // - このsuiteでは実OSのprocess tree terminationを保証しない
    test('started→success→disconnect→exit 0だけをoperation成功として確定する', async () => {
      const child = new FakeChildProcess();
      const logs = new RecordingOutputChannel();
      const operation = runCropPdfProcess(createTestRequest('/workspace', '/workspace/staging/result.pdf'), undefined, {
        launcher: () => child,
        outputChannel: logs,
        requestId: 'fake-success',
      });
      child.emitMessage({ type: 'started', protocolVersion: 1, requestId: 'fake-success' });
      child.emitMessage({ type: 'success', protocolVersion: 1, requestId: 'fake-success' });
      child.emitDisconnect();
      child.emitExit(0, null);

      await assert.doesNotReject(operation);
      assert.strictEqual(child.listenerCount('message'), 0);
      assert.strictEqual(child.listenerCount('exit'), 0);
      assert.strictEqual(child.disposed, true);
      assert.ok(logs.hasLine('process-completed'));
    });

    test('success後の異常exitをcommit可能な成功へ昇格させない', async () => {
      const child = new FakeChildProcess();
      const operation = runCropPdfProcess(createTestRequest('/workspace', '/workspace/staging/result.pdf'), undefined, {
        launcher: () => child,
        requestId: 'fake-success-exit',
      });
      child.emitMessage({ type: 'started', protocolVersion: 1, requestId: 'fake-success-exit' });
      child.emitMessage({ type: 'success', protocolVersion: 1, requestId: 'fake-success-exit' });
      child.emitDisconnect();
      child.emitExit(1, null);

      await assert.rejects(operation, /reported success but exited with code 1/iu);
    });

    for (const [name, messages] of invalidMessageCases()) {
      test(`不正IPC ${name}を成功扱いせずpayloadをログへ出さない`, async () => {
        const child = new FakeChildProcess();
        const logs = new RecordingOutputChannel();
        const operation = runCropPdfProcess(
          createTestRequest('/workspace', '/workspace/staging/result.pdf'),
          undefined,
          {
            launcher: () => child,
            terminate: () => undefined,
            terminationWatchdogMs: 5,
            outputChannel: logs,
            requestId: 'fake-invalid',
          },
        );
        for (const message of messages) {
          child.emitMessage(message);
        }

        await assert.rejects(operation, /protocol error/iu);
        assert.ok(logs.hasLine('protocol-error'));
        assertNoLog(logs, /secret pdf|password|full payload/iu);
        assert.strictEqual(child.listenerCount('message'), 0);
        assert.strictEqual(child.listenerCount('exit'), 0);
        assert.strictEqual(child.disposed, true);
      });
    }

    test('kill後にexit通知が来ないFakeではwatchdogがPromiseを有限時間で終了させる', async () => {
      const child = new FakeChildProcess();
      const controller = new AbortController();
      const logs = new RecordingOutputChannel();
      let terminationRequests = 0;
      const operation = runCropPdfProcess(
        createTestRequest('/workspace', '/workspace/staging/result.pdf'),
        controller.signal,
        {
          launcher: () => child,
          terminate: () => {
            terminationRequests += 1;
          },
          terminationWatchdogMs: 5,
          outputChannel: logs,
          requestId: 'fake-watchdog',
        },
      );
      child.emitMessage({ type: 'started', protocolVersion: 1, requestId: 'fake-watchdog' });
      controller.abort();

      await assert.rejects(operation, { name: 'OperationCancelledError' });
      assert.strictEqual(terminationRequests, 1);
      assert.ok(logs.hasLine('process-termination-requested'));
      assert.ok(logs.hasLine('operation-cancelled'));
      assert.strictEqual(child.listenerCount('message'), 0);
      assert.strictEqual(child.disposed, true);
      assertNoLog(logs, /operation-completed|child-success-received/iu);
    });
  });

  suite('DIしたwriter・launcher・Output Channel', () => {
    test('cropPdfFileのwriterがENOSPCを返すと、成功扱いせずpartial outputをcleanupする', async () => {
      // Real:
      // - 実pdf-libによるsource PDFのload/save
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
      // - このtestでは実child processや実ディスク容量を保証しない
      await withTemporaryWorkspace(async (workspacePath) => {
        const sourcePath = path.join(workspacePath, 'source.pdf');
        const stagedOutputPath = path.join(workspacePath, 'staging', 'result.pdf');
        await mkdir(path.dirname(stagedOutputPath), { recursive: true });
        await copyFile(path.join(operationPdfInputDirectory, 'multilingual-text.pdf'), sourcePath);
        const removedPaths: string[] = [];
        let renameCalled = false;
        const writer: CropPdfFileWriter = {
          writeFile: async () => {
            const error = new Error('No space left on device') as NodeJS.ErrnoException;
            error.code = 'ENOSPC';
            throw error;
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

    test('launcherがENOENTで起動失敗した場合はrequest前に一度だけfailureを記録する', async () => {
      const logs = new RecordingOutputChannel();
      let launcherCalls = 0;
      await assert.rejects(
        runCropPdfProcess(createTestRequest('/workspace', '/workspace/staging/result.pdf'), undefined, {
          launcher: () => {
            launcherCalls += 1;
            const error = new Error('spawn crop runner ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            throw error;
          },
          outputChannel: logs,
          requestId: 'fake-launch-failure',
        }),
        /ENOENT/iu,
      );
      assert.strictEqual(launcherCalls, 1);
      assert.ok(logs.hasLine('child-spawn-failed'));
      assertNoLog(logs, /request-sent|child-started|process-completed|operation-cancelled/iu);
    });
  });

  test('child wrapperはNode childのmessageを転送し、disposeでNode側listenerを解放する', async () => {
    const runnerPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../src/operations/pdf/crop_pdf_runner.js',
    );
    const underlying = fork(runnerPath, [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const child: CropProcessChild = createCropProcessChild(underlying);

    try {
      const message = await new Promise<unknown>((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        underlying.send({ type: 'unknown', protocolVersion: 1, requestId: 'wrapper' });
      });

      assert.deepStrictEqual(message, {
        type: 'failure',
        protocolVersion: 1,
        requestId: 'wrapper',
        error: 'Invalid Crop Configure runner request.',
      });
      assert.strictEqual(underlying.listenerCount('message'), 1);
      child.dispose();
      assert.strictEqual(underlying.listenerCount('message'), 0);
    } finally {
      underlying.kill();
    }
  });
});

class FakeChildProcess extends EventEmitter {
  readonly sentMessages: unknown[] = [];
  readonly pid = 12345;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  disposed = false;

  terminate(): void {
    // The fake intentionally does not emit exit.
  }

  dispose(): void {
    this.disposed = true;
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sentMessages.push(message);
    callback?.(null);
    return true;
  }

  emitMessage(message: unknown): void {
    this.emit('message', message);
  }

  emitDisconnect(): void {
    this.emit('disconnect');
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

function invalidMessageCases(): readonly [string, unknown[]][] {
  const started = { type: 'started', protocolVersion: 1, requestId: 'fake-invalid' };
  const success = { type: 'success', protocolVersion: 1, requestId: 'fake-invalid' };
  const failure = { type: 'failure', protocolVersion: 1, requestId: 'fake-invalid', error: 'secret pdf content' };
  return [
    ['null', [null]],
    ['unknown type', [{ type: 'unknown', protocolVersion: 1, requestId: 'fake-invalid' }]],
    ['missing request ID', [{ type: 'started', protocolVersion: 1 }]],
    ['different request ID', [{ type: 'started', protocolVersion: 1, requestId: 'other' }]],
    ['success twice', [started, success, success]],
    ['failure then success', [started, failure, success]],
    ['success then failure', [started, success, failure]],
  ];
}

function createFixtureLauncher(behavior: string, pidFile?: string): (runnerPath: string) => CropProcessChild {
  return (runnerPath) =>
    createCropProcessChild(
      fork(runnerPath, [], {
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          CROP_PROCESS_FIXTURE_BEHAVIOR: behavior,
          ...(pidFile === undefined ? {} : { CROP_PROCESS_FIXTURE_PID_FILE: pidFile }),
        },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      }),
    );
}

function assertLogSequence(lines: readonly string[], events: readonly string[]): void {
  let lastIndex = -1;
  for (const event of events) {
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
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-crop-process-'));
  try {
    return await callback(workspacePath);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
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
      // The fixture writes its pid after the started message.
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

function isProcessNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ESRCH' || error.code === 'EINVAL');
}
