import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const extensionHostSourcePrefixes = ['core/src/', 'vscode/extension/src/'];

export function buildExtensionHostRuntimeCoverageGlobs(repositoryDirectory) {
  return [
    path.join(repositoryDirectory, 'core', 'dist', '**', '*.js'),
    path.join(repositoryDirectory, 'vscode', 'extension', 'out', 'vscode', 'extension', 'src', '**', '*.js'),
  ].map((pattern) => pattern.replaceAll(path.sep, '/'));
}

export function normalizeExtensionHostSourcePath(sourcePath) {
  const normalized = sourcePath.replaceAll('\\', '/').replace(/^file:\/\//u, '');
  for (const prefix of extensionHostSourcePrefixes) {
    const absoluteIndex = normalized.lastIndexOf(`/${prefix}`);
    if (absoluteIndex >= 0) {
      return normalized.slice(absoluteIndex + 1);
    }
    if (normalized.startsWith(prefix)) {
      return normalized;
    }
  }
  const cleaned = normalized.replace(/^(?:[A-Za-z]:)?\/+|^\.\//u, '');
  // Extension sources are reported relative to the extension package
  // (src/...) because the Extension Host runs with that working directory.
  if (cleaned.startsWith('src/')) {
    return `vscode/extension/${cleaned}`;
  }
  return cleaned;
}

export function isExtensionHostSourcePath(sourcePath) {
  const normalized = normalizeExtensionHostSourcePath(sourcePath);
  return extensionHostSourcePrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function verifyExtensionHostLcov(content, label = 'Extension Host coverage') {
  const sourceFiles = new Set();
  const executedLinesByPrefix = new Map(extensionHostSourcePrefixes.map((prefix) => [prefix, 0]));
  let currentPrefix;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      const sourcePath = normalizeExtensionHostSourcePath(line.slice(3));
      currentPrefix = extensionHostSourcePrefixes.find((prefix) => sourcePath.startsWith(prefix));
      if (currentPrefix !== undefined) {
        sourceFiles.add(sourcePath);
      }
      continue;
    }
    if (currentPrefix === undefined || !line.startsWith('DA:')) {
      continue;
    }
    const hits = Number(line.slice(3).split(',', 2)[1]);
    if (Number.isFinite(hits) && hits > 0) {
      executedLinesByPrefix.set(currentPrefix, (executedLinesByPrefix.get(currentPrefix) ?? 0) + 1);
    }
  }

  if (sourceFiles.size === 0) {
    throw new Error(`${label} is empty`);
  }

  for (const prefix of extensionHostSourcePrefixes) {
    if (![...sourceFiles].some((sourcePath) => sourcePath.startsWith(prefix))) {
      throw new Error(`${label} does not contain ${prefix} sources`);
    }
    if ((executedLinesByPrefix.get(prefix) ?? 0) === 0) {
      throw new Error(`${label} has no executed lines for ${prefix} sources`);
    }
  }

  return {
    executedLines: [...executedLinesByPrefix.values()].reduce((total, value) => total + value, 0),
    sourceFiles: sourceFiles.size,
  };
}

async function main(argv) {
  const coveragePath = path.resolve(argv[0] ?? 'coverage/vscode/lcov.info');
  const result = verifyExtensionHostLcov(await readFile(coveragePath, 'utf8'));
  process.stdout.write(
    `Verified Extension Host coverage: ${result.sourceFiles} source files, ${result.executedLines} executed lines.\n`,
  );
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
