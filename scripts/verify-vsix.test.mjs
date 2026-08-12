import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getRequiredVsixEntries, getTargetSpec, verifyProductionInstall, verifyVsixEntries } from './verify-vsix.mjs';

function validEntries(target) {
  return getRequiredVsixEntries(target).map((entry) => `extension/${entry}`);
}

void test('target mapping includes glibc and the expected native packages', () => {
  assert.deepStrictEqual(getTargetSpec('linux-arm64'), {
    npmOs: 'linux',
    npmCpu: 'arm64',
    libc: 'glibc',
    sharp: 'sharp-linux-arm64',
    libvips: 'sharp-libvips-linux-arm64',
  });
});

void test('required entries include the extension, core runtime, MuPDF, and target Sharp packages', () => {
  const requiredEntries = getRequiredVsixEntries('linux-x64');
  assert.ok(requiredEntries.includes('README.ja.md'));
  assert.ok(requiredEntries.includes('THIRD_PARTY_NOTICES.md'));
  assert.ok(requiredEntries.includes('out/vscode/extension/src/extension.js'));
  assert.ok(requiredEntries.includes('node_modules/@graphics-workbench/core/package.json'));
  assert.ok(requiredEntries.includes('node_modules/@graphics-workbench/core/dist/public/conversion.js'));
  assert.ok(requiredEntries.includes('node_modules/mupdf/package.json'));
  assert.ok(requiredEntries.includes('node_modules/@img/sharp-linux-x64/package.json'));
  assert.ok(requiredEntries.includes('node_modules/@img/sharp-libvips-linux-x64/package.json'));
});

void test('Windows verifies its sharp package without a separate libvips package', () => {
  const result = verifyVsixEntries(validEntries('win32-x64'), 'win32-x64');
  assert.deepStrictEqual(result.nativePackages, ['sharp-win32-x64']);
});

void test('VSIX verification rejects mixed platform native packages', () => {
  assert.throws(
    () =>
      verifyVsixEntries(
        [...validEntries('linux-x64'), 'node_modules/@img/sharp-linuxmusl-x64/package.json'],
        'linux-x64',
      ),
    /unexpected native packages/u,
  );
});

void test('VSIX verification rejects TUI, build-only, and core source entries', () => {
  const forbiddenEntries = [
    'extension/tui/package.json',
    'extension/tui/bun.lock',
    'extension/node_modules/@opentui/core/package.json',
    'extension/node_modules/@types/bun/package.json',
    'extension/node_modules/typescript/package.json',
    'extension/node_modules/@graphics-workbench/core/src/index.ts',
    'extension/node_modules/@graphics-workbench/core/test/index.test.js',
    'extension/node_modules/@graphics-workbench/core/dist/index.js.map',
    'extension/node_modules/@graphics-workbench/core/tsconfig.tsbuildinfo',
    'extension/out/test/operations/example.test.js',
    'extension/out/core/test/operations/example.test.js',
    'extension/out/vscode/extension/test/operations/example.test.js',
    'extension/out/test-support/repository_root.js',
  ];
  for (const forbiddenEntry of forbiddenEntries) {
    assert.throws(
      () => verifyVsixEntries([...validEntries('linux-x64'), forbiddenEntry], 'linux-x64'),
      /forbidden build or Terminal UI entries/u,
    );
  }
});

void test('VSIX verification rejects an archive without the packed core runtime', () => {
  const entries = validEntries('linux-x64').filter(
    (entry) => entry !== 'extension/node_modules/@graphics-workbench/core/package.json',
  );
  assert.throws(() => verifyVsixEntries(entries, 'linux-x64'), /missing required entries/u);
});

void test('production staging verification requires core, MuPDF, and target Sharp files', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-verify-vsix-test-'));
  try {
    const requiredFiles = [
      '@graphics-workbench/core/package.json',
      '@graphics-workbench/core/dist/public/conversion.js',
      'mupdf/package.json',
      'sharp/package.json',
      '@img/sharp-darwin-arm64/package.json',
      '@img/sharp-libvips-darwin-arm64/package.json',
    ];
    for (const relativePath of requiredFiles) {
      const filePath = path.join(temporaryDirectory, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, '{}\n', 'utf8');
    }
    const result = verifyProductionInstall('darwin-arm64', temporaryDirectory);
    assert.deepStrictEqual(result.sharpPackages, ['sharp', 'sharp-darwin-arm64', 'sharp-libvips-darwin-arm64']);

    await rm(path.join(temporaryDirectory, '@graphics-workbench', 'core', 'package.json'));
    assert.throws(() => verifyProductionInstall('darwin-arm64', temporaryDirectory), /missing production files/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
