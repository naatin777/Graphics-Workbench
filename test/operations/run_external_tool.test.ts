// Test target:
// - runExternalTool passes array args to executable and returns stdout/stderr
// - tool name and execution info are logged to Output Channel
// - secret arguments are redacted from logs but passed unchanged to the process
// - non-zero exit rejects and preserves stderr and original cause
// - AbortSignal cancels the child process without producing final output
//
// Mocked:
// - Output Channel (appendLine capture)
//
// Not tested:
// - actual external tool installation
// - platform-specific exit codes beyond non-zero

import assert from 'node:assert/strict';
import { mkdtemp, mkdtempDisposable, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runExternalTool } from '../../src/operations/external_tools/run_external_tool.js';

suite('外部tool runner — 正常実行', () => {
  test('executableへ配列argsを渡しstdoutとstderrを取得できる', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'fixture-tool',
      executable: process.execPath,
      args: ['-e', "process.stdout.write('ok'); process.stderr.write('warn')"],
      outputChannel: { appendLine: (line) => lines.push(line) },
    });

    assert.strictEqual(result.stdout, 'ok');
    assert.strictEqual(result.stderr, 'warn');
  });

  test('timeoutを指定しなくても正常終了する', async () => {
    const result = await runExternalTool({
      toolName: 'fixture-tool',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 400)'],
    });

    assert.strictEqual(result.stdout, '');
  });

  test('timeoutMs 0でタイマーが作られず正常終了する', async () => {
    const result = await runExternalTool({
      toolName: 'fixture-tool',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 400)'],
      timeoutMs: 0,
    });

    assert.strictEqual(result.stdout, '');
  });

  test('tool名と実行情報をOutput Channelへ記録する', async () => {
    const lines: string[] = [];
    await runExternalTool({
      toolName: 'my-tool',
      executable: process.execPath,
      args: ['-e', '1'],
      outputChannel: { appendLine: (line) => lines.push(line) },
    });

    assert.ok(
      lines.some((line) => line.includes('[my-tool] executable:')),
      'should log executable',
    );
    assert.ok(
      lines.some((line) => line.includes('[my-tool] arguments:')),
      'should log arguments',
    );
  });
});

suite('外部tool runner — ログredaction', () => {
  test('secret argumentがログへ出ない', async () => {
    const lines: string[] = [];
    await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: ['-e', '1', 'super-secret-token'],
      outputChannel: { appendLine: (line) => lines.push(line) },
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    assert.ok(!lines.some((line) => line.includes('super-secret-token')), 'secret must not appear in logs');
  });

  test('redacted valueがログへ出る', async () => {
    const lines: string[] = [];
    await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: ['-e', '1', 'super-secret-token'],
      outputChannel: { appendLine: (line) => lines.push(line) },
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    assert.ok(
      lines.some((line) => line.includes('<redacted>')),
      'redacted value should appear in logs',
    );
  });

  test('processへは元のargumentが渡る', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-ext-tool-redaction-'));
    const receivedPath = path.join(workspacePath.path, 'received.txt');

    await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(receivedPath)}, process.argv[process.argv.length - 1])`,
        'super-secret-token',
      ],
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    const received = await readFile(receivedPath, 'utf8');
    assert.strictEqual(received, 'super-secret-token', 'process should receive the original argument');
  });
});

suite('外部tool runner — 実行失敗', () => {
  test('non-zero exitをrejectする', async () => {
    await assert.rejects(
      runExternalTool({
        toolName: 'fail-tool',
        executable: process.execPath,
        args: ['-e', 'process.exit(1)'],
      }),
      (error: unknown) => error instanceof Error,
    );
  });

  test('stderrまたはerror messageをOutput Channelへ残す', async () => {
    const lines: string[] = [];
    await assert.rejects(
      runExternalTool({
        toolName: 'fail-tool',
        executable: process.execPath,
        args: ['-e', "process.stderr.write('boom'); process.exit(2)"],
        outputChannel: { appendLine: (line) => lines.push(line) },
      }),
    );

    assert.ok(
      lines.some((line) => line.includes('[fail-tool] failure:')),
      'should log failure',
    );
    assert.ok(
      lines.some((line) => line.includes('boom')),
      'should include stderr in failure log',
    );
  });

  test('終了コードとstderrを失わない', async () => {
    try {
      await runExternalTool({
        toolName: 'fail-tool',
        executable: process.execPath,
        args: ['-e', "process.stderr.write('failure detail'); process.exit(42)"],
      });
      assert.fail('should have rejected');
    } catch (error: unknown) {
      assert.ok(error instanceof Error);
      assert.strictEqual(error.message, 'fail-tool failed (exited with code 42, signal none)');
      assert.ok('stderr' in error);
      assert.strictEqual(error.stderr, 'failure detail');
    }
  });
});

suite('外部tool runner — タイムアウト', () => {
  test('大量出力でも処理は停止せず、保持する末尾だけに制限する', async () => {
    const result = await runExternalTool({
      toolName: 'output-flood-tool',
      executable: process.execPath,
      args: [
        '-e',
        `process.stdout.write('x'.repeat(2 * 1024 * 1024));
         process.stderr.write('y'.repeat(2 * 1024 * 1024));
         process.exit(0);`,
      ],
    });

    // The tool is not killed for flooding stdout/stderr; only a bounded tail is retained.
    assert.ok(result.stdout.length <= 300 * 1024, 'stdout should be bounded to the retained tail');
    assert.ok(result.stderr.length <= 300 * 1024, 'stderr should be bounded to the retained tail');
    assert.ok(result.stdout.endsWith('x'), 'stdout tail should preserve the end of the output');
    assert.ok(result.stderr.endsWith('y'), 'stderr tail should preserve the end of the output');
  });

  test('非ASCIIの大量出力でもバイト単位で末尾を保持する', async () => {
    const result = await runExternalTool({
      toolName: 'output-flood-multibyte-tool',
      executable: process.execPath,
      args: [
        '-e',
        `process.stdout.write('日本語'.repeat(2 * 1024 * 1024) + 'STDOUT_TAIL');
         process.stderr.write('😀'.repeat(2 * 1024 * 1024) + 'STDERR_TAIL');`,
      ],
    });

    // Multi-byte characters must not be truncated to an empty or short tail (a
    // UTF-16 slice index is not a byte index), and the retained tail must decode.
    assert.ok(Buffer.byteLength(result.stdout) <= 300 * 1024, 'stdout should be bounded to the retained tail');
    assert.ok(Buffer.byteLength(result.stderr) <= 300 * 1024, 'stderr should be bounded to the retained tail');
    assert.ok(Buffer.byteLength(result.stdout) >= 250 * 1024, 'stdout tail should honor the retention cap');
    assert.ok(Buffer.byteLength(result.stderr) >= 250 * 1024, 'stderr tail should honor the retention cap');
    assert.ok(result.stdout.endsWith('STDOUT_TAIL'), 'stdout tail should preserve the end of the output');
    assert.ok(result.stderr.endsWith('STDERR_TAIL'), 'stderr tail should preserve the end of the output');
    assert.ok(result.stdout.includes('日本語'), 'stdout tail should decode multi-byte characters');
    assert.ok(result.stderr.includes('😀'), 'stderr tail should decode multi-byte characters');
  });

  test('timeoutMsを過ぎるとchild processを終了してrejectする', async () => {
    const startedPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'gw-ext-tool-timeout-')), 'started.txt');

    try {
      await assert.rejects(
        runExternalTool({
          toolName: 'timeout-tool',
          executable: process.execPath,
          args: [
            '-e',
            `require('fs').writeFileSync(${JSON.stringify(startedPath)}, 'started');
             setTimeout(() => {}, 30000);`,
          ],
          timeoutMs: 200,
        }),
        (error: unknown) => error instanceof Error,
      );

      await assert.doesNotReject(import('node:fs/promises').then((fs) => fs.stat(startedPath)));
    } finally {
      await rm(path.dirname(startedPath), { recursive: true, force: true });
    }
  });
});

suite('外部tool runner — Cancellation', () => {
  test('AbortSignalがrunExternalToolへ渡り、child processを停止する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-ext-tool-cancel-'));
    const sentinelPath = path.join(workspacePath.path, 'sentinel.txt');
    const startedPath = path.join(workspacePath.path, 'started.txt');

    const controller = new AbortController();

    const promise = runExternalTool({
      toolName: 'long-tool',
      executable: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(startedPath)}, 'started');
         setTimeout(() => require('fs').writeFileSync(${JSON.stringify(sentinelPath)}, 'done'), 30000);`,
      ],
      signal: controller.signal,
    });

    // Wait for the child process to write the started file (observable signal)
    await waitForFile(startedPath, 5000);

    controller.abort();

    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error);
      return error.name === 'AbortError' || error.name === 'Canceled';
    });

    // The sentinel file should NOT exist (child was cancelled before completion)
    let sentinelExists = false;
    try {
      await import('node:fs/promises').then((fs) => fs.stat(sentinelPath));
      sentinelExists = true;
    } catch {
      sentinelExists = false;
    }
    assert.strictEqual(sentinelExists, false, 'sentinel file should not be created after abort');
  });

  test('abort後にfailure logへsecret argumentを漏らさない', async () => {
    const lines: string[] = [];
    const controller = new AbortController();

    const promise = runExternalTool({
      toolName: 'cancel-secret-tool',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 30000)', 'super-secret-token'],
      signal: controller.signal,
      outputChannel: { appendLine: (line) => lines.push(line) },
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    // Wait a moment for the process to start
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();

    await assert.rejects(promise);

    assert.ok(!lines.some((line) => line.includes('super-secret-token')), 'secret must not leak in cancellation log');
  });

  test('SIGTERMを無視するプロセスは終了猶予後に強制終了する', async () => {
    const controller = new AbortController();

    const promise = runExternalTool({
      toolName: 'stubborn-tool',
      executable: process.execPath,
      args: ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000);"],
      signal: controller.signal,
    });

    // Let the child start and install its SIGTERM handler before aborting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();

    // The child ignores SIGTERM, so runExternalTool must force-kill it after the
    // termination grace period and reject.
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof Error);
      return error.name === 'AbortError' || error.name === 'Canceled';
    });
  });

  test('AbortSignalで外部toolの子孫プロセスも停止する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-ext-tool-tree-cancel-'));
    const startedPath = path.join(workspacePath.path, 'started.txt');
    const heartbeatPath = path.join(workspacePath.path, 'heartbeat.txt');

    const controller = new AbortController();
    const treeScript = `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      fs.writeFileSync(process.env.GW_STARTED_PATH, 'started');
      const child = spawn(process.execPath, ['-e', "const fs = require('node:fs'); const beat = () => fs.appendFileSync(process.env.GW_HEARTBEAT_PATH, '.'); beat(); setInterval(beat, 50);"], { stdio: 'ignore', env: process.env });
      setTimeout(() => {}, 30000);
    `;
    const promise = runExternalTool({
      toolName: 'tree-tool',
      executable: process.execPath,
      args: ['-e', treeScript],
      env: { ...process.env, GW_STARTED_PATH: startedPath, GW_HEARTBEAT_PATH: heartbeatPath },
      signal: controller.signal,
    });

    // The descendant heartbeat must grow while the tree is alive.
    await waitForFile(heartbeatPath, 5000);
    const beforeAbort = (await readFile(heartbeatPath)).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillGrowing = (await readFile(heartbeatPath)).length;
    assert.ok(stillGrowing > beforeAbort, 'descendant heartbeat should grow before abort');

    controller.abort();
    await assert.rejects(promise);

    // After abort the descendant heartbeat must stop growing, which proves the
    // descendant process was actually terminated (not merely scheduled to die).
    const afterAbort = (await readFile(heartbeatPath)).length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    const later = (await readFile(heartbeatPath)).length;
    assert.strictEqual(later, afterAbort, 'descendant heartbeat should stop after abort');
  });
});

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const fs = await import('node:fs/promises');
  const start = Date.now();

  for (;;) {
    try {
      await fs.stat(filePath);
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`File not created within ${timeoutMs}ms: ${filePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
