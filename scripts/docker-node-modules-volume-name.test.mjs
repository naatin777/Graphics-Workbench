import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scriptPath = new URL('./docker-node-modules-volume-name.sh', import.meta.url).pathname;

function volumeName(lockfilePath) {
  return execFileSync('bash', [scriptPath, lockfilePath], { encoding: 'utf8' }).trim();
}

function withTempLockfile(content, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'gw-volume-test-'));
  try {
    const lockfilePath = join(directory, 'package-lock.json');
    writeFileSync(lockfilePath, content);
    return callback(lockfilePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

void test('同一 package-lock.json からは同一の volume 名を返す', () => {
  const content = '{"name":"sample","lockfileVersion":3}\n';
  withTempLockfile(content, (firstPath) => {
    withTempLockfile(content, (secondPath) => {
      assert.equal(volumeName(firstPath), volumeName(secondPath));
    });
  });
});

void test('異なる package-lock.json からは異なる volume 名を返す', () => {
  withTempLockfile('{"name":"a"}\n', (firstPath) => {
    withTempLockfile('{"name":"b"}\n', (secondPath) => {
      assert.notEqual(volumeName(firstPath), volumeName(secondPath));
    });
  });
});

void test('volume 名は graphics-workbench-node-modules- で始まる', () => {
  withTempLockfile('{"name":"sample"}\n', (lockfilePath) => {
    assert.match(volumeName(lockfilePath), /^graphics-workbench-node-modules-[0-9a-f]+$/u);
  });
});
