import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreSourceRoot = path.join(repositoryRoot, 'core', 'src');
const allowedPackages = new Set(['mupdf', 'sharp']);
const failures = [];

for (const filePath of collectFiles(coreSourceRoot)) {
  const source = readFileSync(filePath, 'utf8');
  for (const specifier of collectModuleSpecifiers(source)) {
    if (specifier.startsWith('.') || specifier.startsWith('node:')) {
      continue;
    }
    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    if (packageName === undefined || !allowedPackages.has(packageName)) {
      failures.push(`${path.relative(repositoryRoot, filePath)} imports forbidden package ${specifier}`);
    }
  }
}

const rootLock = readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8');
for (const forbiddenDependency of ['@opentui/core', '@types/bun', 'bun-types']) {
  if (rootLock.includes(`"${forbiddenDependency}"`)) {
    failures.push(`package-lock.json contains TUI-only dependency ${forbiddenDependency}`);
  }
}
if (existsSync(path.join(repositoryRoot, 'bun.lock'))) {
  failures.push('root bun.lock must not exist');
}

const corePackage = readJson(path.join(repositoryRoot, 'core', 'package.json'));
const vscodePackage = readJson(path.join(repositoryRoot, 'vscode', 'package.json'));
const tuiPackage = readJson(path.join(repositoryRoot, 'tui', 'package.json'));
if (corePackage.version !== vscodePackage.version) {
  failures.push('core and vscode package versions must match');
}
if (vscodePackage.dependencies?.['@graphics-workbench/core'] !== corePackage.version) {
  failures.push('vscode must depend on the exact matching @graphics-workbench/core version');
}
if (tuiPackage.dependencies?.['@graphics-workbench/core'] !== 'file:.core-package') {
  failures.push('tui must consume its staged local core package');
}

if (failures.length > 0) {
  throw new Error(`Core dependency boundary check failed:\n${failures.join('\n')}`);
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? collectFiles(entryPath)
      : entry.isFile() && entry.name.endsWith('.ts')
        ? [entryPath]
        : [];
  });
}

export function collectModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/gu,
    /<reference\s+types\s*=\s*['"]([^'"]+)['"]/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.add(specifier);
      }
    }
  }
  return specifiers;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
