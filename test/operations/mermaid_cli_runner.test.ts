// Test target:
// - runMermaidCliWithSignalが子プロセスのMermaid CLIへ描画させ、成功時にresolveすること
// - キャンセル要求で子プロセスを終了し、AbortErrorとしてrejectすること
// - タイムアウトで子プロセスを終了し、timeoutエラーとしてrejectすること
// - success + disconnect + exit 0だけを成功として確定し、exitしない子をwatchdogで強制終了すること
//
// Mocked:
// - 親側ライフサイクルsuiteではFakeChildProcessでIPC state machineを検証する
//
// Not tested:
// - 変換コマンド全体の進捗・通知UI
// - runExternalToolのタイムアウト

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { testInputDirectory } from '../helpers/fixture_paths.js';
import {
  type MermaidCliRunRequest,
  runMermaidCliWithSignal,
} from '../../src/operations/conversion/tools/run_mermaid_cli.js';

const operationMermaidInputPath = path.join(testInputDirectory, 'valid', 'mermaid', 'conversion-flowchart.mmd');

suite('Mermaid CLIのキャンセルとタイムアウト', () => {
  test('子プロセスのMermaid CLIでSVGを描画できる', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));

      await runMermaidCliWithSignal({
        sourcePath,
        outputPath,
        outputFormat: 'svg',
        puppeteerConfig: { headless: true, channel: 'chrome' },
        theme: 'default',
        backgroundColor: 'white',
      });

      const svg = await readFile(outputPath, 'utf8');
      assert.ok(svg.includes('<svg'));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('キャンセル済みのsignalでは子プロセスを起動せずAbortErrorでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        runMermaidCliWithSignal(
          {
            sourcePath,
            outputPath,
            outputFormat: 'svg',
            puppeteerConfig: { headless: true, channel: 'chrome' },
            theme: 'default',
            backgroundColor: 'white',
          },
          controller.signal,
          { timeoutMs: 10_000 },
        ),
        /cancelled/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('描画中のキャンセルで子プロセスを終了してAbortErrorでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));
      const controller = new AbortController();
      const pending = runMermaidCliWithSignal(
        {
          sourcePath,
          outputPath,
          outputFormat: 'svg',
          puppeteerConfig: { headless: true, channel: 'chrome' },
          theme: 'default',
          backgroundColor: 'white',
        },
        controller.signal,
        { timeoutMs: 10_000 },
      );
      setTimeout(() => {
        controller.abort();
      }, 300);

      await assert.rejects(pending, /cancelled/);
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('タイムアウトで子プロセスを終了してtimeoutエラーでrejectする', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-mermaid-workspace-'));
    const sourcePath = path.join(workspacePath, 'input.mmd');
    const outputPath = path.join(workspacePath, 'output.svg');

    try {
      await writeFile(sourcePath, await readFile(operationMermaidInputPath));

      await assert.rejects(
        runMermaidCliWithSignal(
          {
            sourcePath,
            outputPath,
            outputFormat: 'svg',
            puppeteerConfig: { headless: true, channel: 'chrome' },
            theme: 'default',
            backgroundColor: 'white',
          },
          undefined,
          { timeoutMs: 100 },
        ),
        /timed out/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});

suite('Mermaid CLI親側ライフサイクル', () => {
  // FakeChildProcessはOS processを起動せず、親のIPC state machineとwatchdogだけを検証する。
  test('success→disconnect→exit 0だけを成功としてresolveし、listenerを解放する', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
    });

    child.emitMessage({ ok: true });
    child.emitDisconnect();
    child.emitExit(0, null);

    await assert.doesNotReject(operation);
    assert.strictEqual(child.listenerCount('message'), 0);
    assert.strictEqual(child.listenerCount('exit'), 0);
    assert.strictEqual(child.disposed, true);
  });

  test('success通知後の異常exitを成功へ昇格させない', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
    });

    child.emitMessage({ ok: true });
    child.emitDisconnect();
    child.emitExit(1, null);

    await assert.rejects(operation, /reported success but exited with code 1/iu);
  });

  test('disconnect前にexitすると成功扱いしない', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
    });

    child.emitMessage({ ok: true });
    child.emitExit(0, null);

    await assert.rejects(operation, /exited before disconnecting after success/iu);
  });

  test('successの前にexitすると成功扱いしない', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
    });

    child.emitExit(0, null);

    await assert.rejects(operation, /before success/iu);
  });

  test('success→disconnect後にexitしないFakeはcompletion grace後にterminateする', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
      completionGraceMs: 5,
      terminationWatchdogMs: 5,
    });

    child.emitMessage({ ok: true });
    child.emitDisconnect();

    await assert.rejects(operation, /did not exit after success/iu);
    assert.strictEqual(child.terminationRequests, 1);
  });

  test('failure→disconnect後にexitしないFakeもfailureを保ったままterminateする', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
      completionGraceMs: 5,
      terminationWatchdogMs: 5,
    });

    child.emitMessage({ ok: false, error: 'child failed' });
    child.emitDisconnect();

    await assert.rejects(operation, /child failed/iu);
    assert.strictEqual(child.terminationRequests, 1);
  });

  test('duplicate completion messageは成功扱いしない', async () => {
    const child = new FakeMermaidCliChild();
    const operation = runMermaidCliWithSignal(createTestRequest(), undefined, {
      launcher: () => child,
    });

    child.emitMessage({ ok: true });
    child.emitMessage({ ok: true });
    child.emitDisconnect();
    child.emitExit(0, null);

    await assert.rejects(operation, /duplicate or conflicting completion message/iu);
  });
});

class FakeMermaidCliChild extends EventEmitter {
  readonly sentMessages: unknown[] = [];
  terminationRequests = 0;
  disposed = false;

  send(message: MermaidCliRunRequest, callback?: (error: Error | null) => void): boolean {
    this.sentMessages.push(message);
    callback?.(null);
    return true;
  }

  terminate(): void {
    this.terminationRequests += 1;
  }

  dispose(): void {
    this.disposed = true;
  }

  emitMessage(message: unknown): void {
    this.emit('message', message);
  }

  emitDisconnect(): void {
    this.emit('disconnect');
  }

  emitExit(code: number | null, signal: null): void {
    this.emit('exit', code, signal);
  }
}

function createTestRequest(): MermaidCliRunRequest {
  return {
    sourcePath: '/workspace/input.mmd',
    outputPath: '/workspace/output.svg',
    outputFormat: 'svg',
    puppeteerConfig: {},
  };
}
