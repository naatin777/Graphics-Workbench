import assert from 'node:assert/strict';
import test from 'node:test';

import { getTargetSpec, verifyVsixEntries } from './verify-vsix.mjs';

void test('target mapping includes glibc and the expected native packages', () => {
  assert.deepStrictEqual(getTargetSpec('linux-arm64'), {
    npmOs: 'linux',
    npmCpu: 'arm64',
    libc: 'glibc',
    sharp: 'sharp-linux-arm64',
    libvips: 'sharp-libvips-linux-arm64',
  });
});

void test('Windows verifies its sharp package without a separate libvips package', () => {
  const result = verifyVsixEntries(
    ['extension/node_modules/sharp/package.json', 'extension/node_modules/@img/sharp-win32-x64/package.json'],
    'win32-x64',
  );
  assert.deepStrictEqual(result.nativePackages, ['sharp-win32-x64']);
});

void test('VSIX verification rejects mixed platform native packages', () => {
  assert.throws(
    () =>
      verifyVsixEntries(
        [
          'node_modules/sharp/package.json',
          'node_modules/@img/sharp-linux-x64/package.json',
          'node_modules/@img/sharp-libvips-linux-x64/package.json',
          'node_modules/@img/sharp-linuxmusl-x64/package.json',
        ],
        'linux-x64',
      ),
    /unexpected native packages/u,
  );
});
