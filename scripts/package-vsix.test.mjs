import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendStagingIgnoreRules,
  assembleInstalledExtension,
  getProductionInstallArguments,
  packagingDocumentation,
  parsePackOutput,
  prepareStagingManifest,
} from './package-vsix.mjs';

void test('staging preserves extension documentation and third-party notices', () => {
  assert.deepStrictEqual(packagingDocumentation, [
    'CHANGELOG.md',
    'LICENSE',
    'README.md',
    'README.ja.md',
    'THIRD_PARTY_NOTICES.md',
  ]);
});

void test('production install uses packed workspaces and the selected target without a lockfile', () => {
  const args = getProductionInstallArguments(
    '/tmp/install',
    'linux-arm64',
    '/tmp/graphics-workbench.tgz',
    '/tmp/graphics-workbench-core.tgz',
  );
  assert.deepStrictEqual(args.slice(0, 3), ['install', '--prefix', '/tmp/install']);
  assert.ok(args.includes('--package-lock=false'));
  assert.ok(args.includes('--omit=dev'));
  assert.ok(args.includes('--include=optional'));
  assert.ok(args.includes('--os=linux'));
  assert.ok(args.includes('--cpu=arm64'));
  assert.ok(args.includes('--libc=glibc'));
  assert.deepStrictEqual(args.slice(-2), ['/tmp/graphics-workbench.tgz', '/tmp/graphics-workbench-core.tgz']);
});

void test('production install preserves the six-platform VSIX target contract', () => {
  const expectedTargets = new Map([
    ['darwin-arm64', ['--os=darwin', '--cpu=arm64']],
    ['darwin-x64', ['--os=darwin', '--cpu=x64']],
    ['linux-arm64', ['--os=linux', '--cpu=arm64', '--libc=glibc']],
    ['linux-x64', ['--os=linux', '--cpu=x64', '--libc=glibc']],
    ['win32-arm64', ['--os=win32', '--cpu=arm64']],
    ['win32-x64', ['--os=win32', '--cpu=x64']],
  ]);
  for (const [target, expectedArguments] of expectedTargets) {
    const args = getProductionInstallArguments('/tmp/install', target, '/tmp/vscode.tgz', '/tmp/core.tgz');
    for (const expectedArgument of expectedArguments) {
      assert.ok(args.includes(expectedArgument), `${target} is missing ${expectedArgument}`);
    }
  }
});

void test('npm pack output must name one safe tarball', () => {
  assert.equal(
    parsePackOutput('[{"filename":"graphics-workbench-1.0.0.tgz"}]', '/tmp/packages'),
    '/tmp/packages/graphics-workbench-1.0.0.tgz',
  );
  assert.equal(
    parsePackOutput('{"graphics-workbench":{"filename":"graphics-workbench-1.0.0.tgz"}}', '/tmp/packages'),
    '/tmp/packages/graphics-workbench-1.0.0.tgz',
  );
  assert.throws(() => parsePackOutput('[{"filename":"../escape.tgz"}]', '/tmp/packages'), /unsafe/u);
  assert.throws(() => parsePackOutput('[]', '/tmp/packages'), /exactly one/u);
});

void test('assembled staging owns the installed extension and production closure', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-package-vsix-test-'));
  try {
    const installDirectory = path.join(temporaryDirectory, 'install');
    const stagingDirectory = path.join(temporaryDirectory, 'staging');
    const installedNodeModules = path.join(installDirectory, 'node_modules');
    const extensionPackage = path.join(installedNodeModules, 'graphics-workbench', 'package.json');
    const corePackage = path.join(installedNodeModules, '@graphics-workbench', 'core', 'package.json');
    const hiddenLock = path.join(installedNodeModules, '.package-lock.json');
    const binaryShim = path.join(installedNodeModules, '.bin', 'unused');
    for (const filePath of [extensionPackage, corePackage, hiddenLock, binaryShim]) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, '{}\n', 'utf8');
    }

    await assembleInstalledExtension(installDirectory, stagingDirectory);

    assert.equal(await readFile(path.join(stagingDirectory, 'package.json'), 'utf8'), '{}\n');
    assert.equal(
      await readFile(
        path.join(stagingDirectory, 'node_modules', '@graphics-workbench', 'core', 'package.json'),
        'utf8',
      ),
      '{}\n',
    );
    await assert.rejects(readFile(path.join(stagingDirectory, 'node_modules', '.package-lock.json')), /ENOENT/u);
    await assert.rejects(readFile(path.join(stagingDirectory, 'node_modules', '.bin', 'unused')), /ENOENT/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

void test('staging manifest drops the tarball files allowlist before adding .vscodeignore', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-package-manifest-test-'));
  try {
    await writeFile(
      path.join(temporaryDirectory, 'package.json'),
      '{"name":"graphics-workbench","files":["out"]}\n',
      'utf8',
    );
    await prepareStagingManifest(temporaryDirectory);
    assert.deepStrictEqual(JSON.parse(await readFile(path.join(temporaryDirectory, 'package.json'), 'utf8')), {
      name: 'graphics-workbench',
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

void test('staging ignore excludes dependency build metadata', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-package-ignore-test-'));
  try {
    await writeFile(path.join(temporaryDirectory, '.vscodeignore'), '**/*.map\n', 'utf8');
    await appendStagingIgnoreRules(temporaryDirectory);
    assert.equal(
      await readFile(path.join(temporaryDirectory, '.vscodeignore'), 'utf8'),
      '**/*.map\n**/*.tsbuildinfo\nout/core/test/**\nout/vscode/test/**\nout/test-support/**\nout/test/**\n',
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
