import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreSourceRoot = path.join(repositoryRoot, 'core', 'src');
const vscodeSourceRoot = path.join(repositoryRoot, 'vscode', 'src');
const vscodeTestRoot = path.join(repositoryRoot, 'vscode', 'test');
const tuiSourceRoot = path.join(repositoryRoot, 'tui', 'src');
const tuiTestRoot = path.join(repositoryRoot, 'tui', 'test');
const failures = [];

const corePackage = readJson(path.join(repositoryRoot, 'core', 'package.json'));
const vscodePackage = readJson(path.join(repositoryRoot, 'vscode', 'package.json'));
const tuiPackage = readJson(path.join(repositoryRoot, 'tui', 'package.json'));
const rootPackage = readJson(path.join(repositoryRoot, 'package.json'));
const publicCoreEntries = new Set(
  Object.keys(corePackage.exports ?? {})
    .filter((entry) => entry.startsWith('./'))
    .map((entry) => entry.slice(2)),
);

checkCoreImports();
checkFrontendImports('vscode', [vscodeSourceRoot], vscodePackage, ['vscode']);
checkFrontendImports('vscode', [vscodeTestRoot], vscodePackage, ['vscode']);
checkFrontendImports('tui', [tuiSourceRoot, tuiTestRoot], tuiPackage, []);
checkCorePublicImports([vscodeSourceRoot, vscodeTestRoot, tuiSourceRoot, tuiTestRoot]);
checkFrontendBoundaryImports('vscode', [vscodeSourceRoot, vscodeTestRoot], 'tui');
checkFrontendBoundaryImports('tui', [tuiSourceRoot, tuiTestRoot], 'vscode');
checkPackageVersions();
checkCoreExports();
checkPackageOwnership();
checkLockfiles();

if (failures.length > 0) {
  throw new Error(`Package boundary check failed:\n${failures.join('\n')}`);
}

function checkCoreImports() {
  const declaredDependencies = new Set(Object.keys(corePackage.dependencies ?? {}));
  for (const filePath of collectFiles(coreSourceRoot)) {
    const source = readFileSync(filePath, 'utf8');
    if (/\b(?:VS Code|Terminal UI|TUI|Extension Host)\b/u.test(source)) {
      failures.push(`${relative(filePath)} contains frontend-specific policy terminology`);
    }

    for (const specifier of collectModuleSpecifiers(source)) {
      if (specifier.startsWith('.') || specifier.startsWith('node:')) {
        continue;
      }
      const packageName = packageNameFor(specifier);
      if (
        packageName === 'vscode' ||
        packageName === 'bun' ||
        packageName === 'bun-types' ||
        packageName.startsWith('@opentui/')
      ) {
        failures.push(`${relative(filePath)} imports frontend-only package ${specifier}`);
        continue;
      }
      if (!declaredDependencies.has(packageName)) {
        failures.push(`${relative(filePath)} imports undeclared core dependency ${specifier}`);
      }
    }
  }
}

function checkFrontendImports(frontend, roots, packageJson, builtInPackages) {
  const declaredDependencies = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
  for (const root of roots) {
    for (const filePath of collectFiles(root)) {
      for (const specifier of collectModuleSpecifiers(readFileSync(filePath, 'utf8'))) {
        if (specifier.startsWith('.') || specifier.startsWith('node:') || specifier.startsWith('bun:')) {
          continue;
        }
        const packageName = packageNameFor(specifier);
        if (builtInPackages.includes(packageName)) {
          continue;
        }
        if (!declaredDependencies.has(packageName)) {
          failures.push(`${relative(filePath)} imports undeclared ${frontend} dependency ${specifier}`);
        }
      }
    }
  }
}

function checkCorePublicImports(roots) {
  const packagePrefix = '@graphics-workbench/core/';
  for (const root of roots) {
    for (const filePath of collectFiles(root)) {
      for (const specifier of collectModuleSpecifiers(readFileSync(filePath, 'utf8'))) {
        if (!specifier.startsWith(packagePrefix)) {
          continue;
        }
        const entry = specifier.slice(packagePrefix.length);
        if (!publicCoreEntries.has(entry)) {
          failures.push(`${relative(filePath)} imports non-public core module ${specifier}`);
        }
      }
    }
  }
}

function checkPackageOwnership() {
  if (!corePackage.dependencies?.sharp) {
    failures.push('core must own sharp as a production dependency');
  }
  if (vscodePackage.dependencies?.sharp !== undefined) {
    failures.push('vscode must not ship sharp as a production dependency');
  }
  if (!vscodePackage.devDependencies?.sharp) {
    failures.push('vscode test tooling must declare sharp as a devDependency');
  }

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

function checkFrontendBoundaryImports(frontend, roots, forbiddenFrontend) {
  const forbiddenPackage = forbiddenFrontend === 'tui' ? 'graphics-workbench-tui' : 'vscode';
  for (const root of roots) {
    for (const filePath of collectFiles(root)) {
      for (const specifier of collectModuleSpecifiers(readFileSync(filePath, 'utf8'))) {
        if (specifier === forbiddenPackage || specifier.startsWith(`${forbiddenPackage}/`)) {
          failures.push(`${relative(filePath)} imports ${forbiddenFrontend} from ${frontend}`);
        }
        if (!specifier.startsWith('.')) {
          continue;
        }
        const resolvedPath = path.resolve(path.dirname(filePath), specifier);
        const normalized = resolvedPath.replaceAll('\\', '/');
        if (normalized.includes(`/${forbiddenFrontend}/`)) {
          failures.push(`${relative(filePath)} reaches ${forbiddenFrontend} source through ${specifier}`);
        }
      }
    }
  }
}

function checkPackageVersions() {
  if (corePackage.version !== vscodePackage.version) {
    failures.push('core and vscode package versions must match');
  }
  if (vscodePackage.dependencies?.['@graphics-workbench/core'] !== corePackage.version) {
    failures.push('vscode must depend on the exact matching @graphics-workbench/core version');
  }
  if (tuiPackage.dependencies?.['@graphics-workbench/core'] !== 'file:.core-package') {
    failures.push('tui must consume its staged local core package');
  }
}

function checkCoreExports() {
  if (Object.keys(corePackage.exports ?? {}).some((entry) => entry.includes('*'))) {
    failures.push('core package exports must not expose a wildcard or private file layout');
  }
  for (const entry of publicCoreEntries) {
    const sourcePath = path.join(coreSourceRoot, 'public', `${entry.replaceAll('-', '_')}.ts`);
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

function collectFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
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

function packageNameFor(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function relative(filePath) {
  return path.relative(repositoryRoot, filePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
