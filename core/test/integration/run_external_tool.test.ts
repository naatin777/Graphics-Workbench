// Test target:
// - runExternalTool passes array args to executable and returns stdout/stderr
// - tool name and execution info are logged to Output Channel
// - secret arguments are redacted from logs but passed unchanged to the process
// - non-zero exit returns an Err with stderr and original cause
// - AbortSignal cancels the child process without producing final output
//
// Mocked:
// - Output Channel (appendLine capture)
//
// Not tested:
// - actual external tool installation
// - platform-specific exit codes beyond non-zero

import assert from 'node:assert/strict';
import { mkdtempDisposable, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  runExternalTool,
  ExternalToolCancelledError,
  ExternalToolFailedError,
  ExternalToolTimedOutError,
} from '@graphics-workbench/core/external-tools';

describe('外部CLIツールを起動して標準出力・標準エラーを取得する処理の正常実行', () => {
  it('executableへ配列argsを渡して実行すると、プロセスが書き出したstdoutとstderrをそのまま取得する', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'testdata-tool',
      executable: process.execPath,
      args: ['-e', "process.stdout.write('ok'); process.stderr.write('warn')"],
      outputChannel: { appendLine: (line) => lines.push(line) },
    });

    assert.ok(result.isOk());
    assert.strictEqual(result.value.stdout, 'ok');
    assert.strictEqual(result.value.stderr, 'warn');
  });

  it('timeoutMsを指定せずに400ms待ってexit 0する子プロセスはタイマーなしで正常終了する', async () => {
    const result = await runExternalTool({
      toolName: 'testdata-tool',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 400)'],
    });

    assert.ok(result.isOk());
    assert.strictEqual(result.value.stdout, '');
  });

  it('timeoutMs 0を指定してもタイマーを作らず、遅れてexit 0する子プロセスを最後まで待って正常終了する', async () => {
    const result = await runExternalTool({
      toolName: 'testdata-tool',
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 400)'],
      timeoutMs: 0,
    });

    assert.ok(result.isOk());
    assert.strictEqual(result.value.stdout, '');
  });

  it('tool名と実行ファイル・引数をOutput Channelの[my-tool]行へ記録する', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'my-tool',
      executable: process.execPath,
      args: ['-e', '1'],
      outputChannel: { appendLine: (line) => lines.push(line) },
    });

    assert.ok(result.isOk());
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

describe('外部CLIツールを起動して標準出力・標準エラーを取得する処理のログredaction', () => {
  it('secret引数は実行ログへ一切出力されない', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: ['-e', '1', 'super-secret-token'],
      outputChannel: { appendLine: (line) => lines.push(line) },
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    assert.ok(result.isOk());
    assert.ok(!lines.some((line) => line.includes('super-secret-token')), 'secret must not appear in logs');
  });

  it('secret引数は<redacted>へ置き換えられてログに現れる', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: ['-e', '1', 'super-secret-token'],
      outputChannel: { appendLine: (line) => lines.push(line) },
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    assert.ok(result.isOk());
    assert.ok(
      lines.some((line) => line.includes('<redacted>')),
      'redacted value should appear in logs',
    );
  });

  it('redactionはログだけに適用され、実際のprocessには元のsecret引数が渡る', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-ext-tool-redaction-'));
    const receivedPath = path.join(workspacePath.path, 'received.txt');

    const result = await runExternalTool({
      toolName: 'redact-tool',
      executable: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(receivedPath)}, process.argv[process.argv.length - 1])`,
        'super-secret-token',
      ],
      redactArgument: (_argument, index) => (index === 2 ? '<redacted>' : _argument),
    });

    assert.ok(result.isOk());
    const received = await readFile(receivedPath, 'utf8');
    assert.strictEqual(received, 'super-secret-token', 'process should receive the original argument');
  });
});

describe('外部CLIツールを起動して標準出力・標準エラーを取得する処理の実行失敗', () => {
  it('子プロセスが非0のexit codeで終了するとExternalToolFailedErrorで失敗する', async () => {
    const result = await runExternalTool({
      toolName: 'fail-tool',
      executable: process.execPath,
      args: ['-e', 'process.exit(1)'],
    });

    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolFailedError);
  });

  it('非0 exitの失敗時はtool名のfailure行をOutput Channelへ書き、stderrの内容も含める', async () => {
    const lines: string[] = [];
    const result = await runExternalTool({
      toolName: 'fail-tool',
      executable: process.execPath,
      args: ['-e', "process.stderr.write('boom'); process.exit(2)"],
      outputChannel: { appendLine: (line) => lines.push(line) },
    });

    assert.ok(result.isErr());
    assert.ok(
      lines.some((line) => line.includes('[fail-tool] failure:')),
      'should log failure',
    );
    assert.ok(
      lines.some((line) => line.includes('boom')),
      'should include stderr in failure log',
    );
  });

  it('exit code 42で終了すると、終了コードとstderrをExternalToolFailedErrorのプロパティに保持する', async () => {
    const result = await runExternalTool({
      toolName: 'fail-tool',
      executable: process.execPath,
      args: ['-e', "process.stderr.write('failure detail'); process.exit(42)"],
    });

    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolFailedError);
    assert.strictEqual(result.error.message, 'fail-tool failed (exited with code 42, signal none)');
    assert.strictEqual(result.error.stderr, 'failure detail');
    assert.strictEqual(result.error.exitCode, 42);
  });
});

describe('外部CLIツールを起動して標準出力・標準エラーを取得する処理のタイムアウト', () => {
  it('2MBのstdout/stderrを大量出力してもkillせず、保持上限300KBの末尾だけを残す', async () => {
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
    assert.ok(result.isOk());
    assert.ok(result.value.stdout.length <= 300 * 1024, 'stdout should be bounded to the retained tail');
    assert.ok(result.value.stderr.length <= 300 * 1024, 'stderr should be bounded to the retained tail');
    assert.ok(result.value.stdout.endsWith('x'), 'stdout tail should preserve the end of the output');
    assert.ok(result.value.stderr.endsWith('y'), 'stderr tail should preserve the end of the output');
  });

  it('日本語や絵文字の大量出力もバイト単位で300KB以下に制限しつつ250KB以上の末尾と終端文字列を保持してデコードできる', async () => {
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
    assert.ok(result.isOk());
    assert.ok(Buffer.byteLength(result.value.stdout) <= 300 * 1024, 'stdout should be bounded to the retained tail');
    assert.ok(Buffer.byteLength(result.value.stderr) <= 300 * 1024, 'stderr should be bounded to the retained tail');
    assert.ok(Buffer.byteLength(result.value.stdout) >= 250 * 1024, 'stdout tail should honor the retention cap');
    assert.ok(Buffer.byteLength(result.value.stderr) >= 250 * 1024, 'stderr tail should honor the retention cap');
    assert.ok(result.value.stdout.endsWith('STDOUT_TAIL'), 'stdout tail should preserve the end of the output');
    assert.ok(result.value.stderr.endsWith('STDERR_TAIL'), 'stderr tail should preserve the end of the output');
    assert.ok(result.value.stdout.includes('日本語'), 'stdout tail should decode multi-byte characters');
    assert.ok(result.value.stderr.includes('😀'), 'stderr tail should decode multi-byte characters');
  });

  it('timeoutMs 200を過ぎても終了しない子プロセスは終了させてExternalToolTimedOutErrorで失敗する', async () => {
    await using outsideDirectoryDisposable = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-ext-tool-timeout-'));
    const outsideDirectory = outsideDirectoryDisposable.path;
    const startedPath = path.join(outsideDirectory, 'started.txt');

    const result = await runExternalTool({
      toolName: 'timeout-tool',
      executable: process.execPath,
      args: [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(startedPath)}, 'started');
           setTimeout(() => {}, 30000);`,
      ],
      timeoutMs: 200,
    });

    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolTimedOutError);
    assert.match(result.error.message, /timed out after 200ms/);
    await assert.doesNotReject(import('node:fs/promises').then((fs) => fs.stat(startedPath)));
  });
});

describe('外部CLIツールを起動して標準出力・標準エラーを取得する処理のキャンセル', () => {
  it('startedファイルを書いた子プロセスをAbortSignalでabortすると、完了前に停止されExternalToolCancelledErrorで失敗しsentinelファイルも作られない', async () => {
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

    const result = await promise;
    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolCancelledError);

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

  it('abort時の失敗ログにもsecret引数を漏らさない', async () => {
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

    const result = await promise;
    assert.ok(result.isErr());

    assert.ok(!lines.some((line) => line.includes('super-secret-token')), 'secret must not leak in cancellation log');
  });

  it('SIGTERMを無視する子プロセスは終了猶予期間を過ぎると強制終了され、ExternalToolCancelledErrorで失敗する', async () => {
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

    const result = await promise;
    assert.ok(result.isErr());
    assert.ok(result.error instanceof ExternalToolCancelledError);
  });

  it('外部toolの子孫プロセスもprocess treeごと停止し、abort後はheartbeatファイルの増加が止まる', async () => {
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
    const result = await promise;
    assert.ok(result.isErr());

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
