// Test target:
// - terminateProcessTree on Windows runs taskkill /pid <pid> /t /f against the
//   whole process tree FIRST (never child.kill() first, so a fast-exiting parent
//   cannot strand Draw.io/Chromium descendants)
// - child.kill() is only the fallback when taskkill cannot run or fails
// - a child that already exited is left alone
//
// Mocked:
// - node:child_process.spawn (via node:test module mocks)
// - process.platform (forced to win32 for the Windows branch)
//
// node:test module mocks require the --experimental-test-module-mocks flag. The
// suite is imported from node:test, so under mocha (extension host) these tests
// are never executed; every test is also skipped when the flag is absent.
//
// Run with:
//   node --experimental-test-module-mocks --test vscode/extension/out/core/test/unit/operations/terminate_process_tree.test.js

import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { mock, suite, test } from 'node:test';

const moduleMocksAvailable = typeof mock.module === 'function';

type SpawnCall = { command: string; args: string[] };
type TaskkillListeners = { error?: (value: unknown) => void; exit?: (value: unknown) => void };

const spawnCalls: SpawnCall[] = [];
let taskkillListeners: TaskkillListeners = {};

if (moduleMocksAvailable) {
  // Node 24 deprecates MockModuleOptions.namedExports in favor of exports;
  // namedExports is kept because the installed @types/node (22.x) types it.
  mock.module('node:child_process', { namedExports: { spawn: spawnMock } });
}

function spawnMock(
  command: string,
  args: string[],
): { on: (event: 'error' | 'exit', listener: (value: unknown) => void) => void; unref: () => void } {
  spawnCalls.push({ command, args });
  taskkillListeners = {};
  return {
    on: (event, listener) => {
      taskkillListeners[event] = listener;
    },
    unref: () => {},
  };
}

const { terminateProcessTree } = await import('@graphics-workbench/core/external-tools');

type FakeChild = {
  pid: number;
  exitCode: number | null;
  signalCode: ChildProcess['signalCode'];
  killed: number;
  kill: () => boolean;
};

const createChild = (overrides: Partial<FakeChild>): FakeChild => ({
  pid: 4242,
  exitCode: null,
  signalCode: null,
  killed: 0,
  kill(): boolean {
    this.killed += 1;
    return true;
  },
  ...overrides,
});

const callAsWindows = (child: FakeChild): void => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    terminateProcessTree(child);
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
};

const runTest = (title: string, fn: () => void): void => {
  if (moduleMocksAvailable) {
    void test(title, fn);
    return;
  }
  void test.skip(title, fn);
};

void suite('terminateProcessTreeのWindows挙動', () => {
  runTest('Windowsでは最初にtaskkill /pid /t /fを起動し、child.kill()を先に実行しない', () => {
    spawnCalls.length = 0;
    const child = createChild({});

    callAsWindows(child);

    assert.deepStrictEqual(spawnCalls, [{ command: 'taskkill', args: ['/pid', '4242', '/t', '/f'] }]);
    assert.strictEqual(child.killed, 0, 'child.kill() should not be the first action');
  });

  runTest('taskkillが非0 exitで失敗した場合はchild.kill()をフォールバックとして呼ぶ', () => {
    spawnCalls.length = 0;
    const child = createChild({});

    callAsWindows(child);
    taskkillListeners.exit?.(1);

    assert.strictEqual(child.killed, 1, 'child.kill() should be called when taskkill fails');
  });

  runTest('taskkillの起動がerror（ENOENT等）で失敗した場合もchild.kill()をフォールバックとして呼ぶ', () => {
    spawnCalls.length = 0;
    const child = createChild({});

    callAsWindows(child);
    taskkillListeners.error?.(new Error('ENOENT'));

    assert.strictEqual(child.killed, 1, 'child.kill() should be called when taskkill cannot run');
  });

  runTest('taskkillがexit 0で成功した場合はchild.kill()を呼ばない', () => {
    spawnCalls.length = 0;
    const child = createChild({});

    callAsWindows(child);
    taskkillListeners.exit?.(0);

    assert.strictEqual(child.killed, 0, 'child.kill() is only a fallback');
  });

  runTest('childが既にexitしている場合はtaskkillもchild.kill()も呼ばず放置する', () => {
    spawnCalls.length = 0;
    const child = createChild({ exitCode: 1 });

    callAsWindows(child);

    assert.strictEqual(spawnCalls.length, 0, 'taskkill should not run for an exited child');
    assert.strictEqual(child.killed, 0, 'an exited child should be left alone');
  });
});
