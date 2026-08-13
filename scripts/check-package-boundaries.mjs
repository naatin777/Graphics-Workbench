// Package metadata checks that inspect package.json files, exports maps, and
// lockfiles. Import/architecture rules live in the Oxlint project plugin
// (scripts/oxlint-project-plugin.mjs), which sees the AST and file locations.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreSourceRoot = path.join(repositoryRoot, 'core', 'src');
const failures = [];

const corePackage = readJson(path.join(repositoryRoot, 'core', 'package.json'));
const tuiPackage = readJson(path.join(repositoryRoot, 'tui', 'package.json'));
const rootPackage = readJson(path.join(repositoryRoot, 'package.json'));
const publicCoreEntries = new Set(
  Object.keys(corePackage.exports ?? {})
    .filter((entry) => entry.startsWith('./'))
    .map((entry) => entry.slice(2)),
);

checkCoreExports();
checkPackageVersions();
checkPackageOwnership();
checkLockfiles();

if (failures.length > 0) {
  throw new Error(`Package boundary check failed:\n${failures.join('\n')}`);
}

function checkPackageOwnership() {
  for (const dependency of [
    '@types/mocha',
    '@types/sinon',
    '@types/vscode',
    '@vscode/test-cli',
    '@vscode/test-electron',
    'jsdom',
    'mocha',
    'pdfjs-dist',
    'sinon',
    'solid-js',
    'vite',
    'vite-plugin-solid',
    'vitest',
  ]) {
    if (rootPackage.devDependencies?.[dependency] !== undefined) {
      failures.push(`root must not own frontend-only dependency ${dependency}`);
    }
  }
}

function checkPackageVersions() {
  if (tuiPackage.dependencies?.['@graphics-workbench/core'] !== 'file:.core-package') {
    failures.push('tui must consume its staged local core package');
  }
}

function checkCoreExports() {
  if (Object.keys(corePackage.exports ?? {}).some((entry) => entry.includes('*'))) {
    failures.push('core package exports must not expose a wildcard or private file layout');
  }
  for (const entry of publicCoreEntries) {
    const sourcePath =
      entry === 'testing'
        ? path.join(repositoryRoot, 'core', 'testing', 'index.ts')
        : path.join(coreSourceRoot, 'public', `${entry.replaceAll('-', '_')}.ts`);
    if (!existsSync(sourcePath)) {
      failures.push(`core public entry ${entry} has no source module at ${relative(sourcePath)}`);
    }
  }
}

function checkLockfiles() {
  const rootLock = readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8');
  for (const forbiddenDependency of ['@opentui/core', '@types/bun', 'bun-types']) {
    if (rootLock.includes(`"${forbiddenDependency}"`)) {
      failures.push(`package-lock.json contains TUI-only dependency ${forbiddenDependency}`);
    }
  }
  if (existsSync(path.join(repositoryRoot, 'bun.lock'))) {
    failures.push('root bun.lock must not exist');
  }
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
