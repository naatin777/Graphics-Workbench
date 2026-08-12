import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVscodeTestArguments, collectCompiledTestFiles } from './compiled-test-files.mjs';

const repositoryDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vscodeDirectory = path.join(repositoryDirectory, 'vscode');
const coreTestFiles = collectCompiledTestFiles(
  vscodeDirectory,
  'out/core/test',
  new Set(['terminate_process_tree.test.js']),
);

if (coreTestFiles.length === 0) {
  throw new Error('No compiled core tests were found. Run npm run compile:test first.');
}

const vscodeTestCliPackage = createRequire(path.join(vscodeDirectory, 'package.json')).resolve('@vscode/test-cli');
const vscodeTestCli = path.join(path.dirname(vscodeTestCliPackage), 'bin.mjs');
const runArguments = buildVscodeTestArguments(coreTestFiles, process.argv.slice(2));
execFileSync(process.execPath, [vscodeTestCli, ...runArguments], {
  cwd: vscodeDirectory,
  stdio: 'inherit',
});
