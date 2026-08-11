import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVscodeTestArguments, collectCompiledTestFiles } from './compiled-test-files.mjs';

const repositoryDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const coreTestFiles = collectCompiledTestFiles(
  repositoryDirectory,
  'vscode/out/core/test',
  new Set(['terminate_process_tree.test.js']),
);

if (coreTestFiles.length === 0) {
  throw new Error('No compiled core tests were found. Run npm run compile:test first.');
}

const vscodeTestCli = path.join(repositoryDirectory, 'node_modules', '@vscode', 'test-cli', 'out', 'bin.mjs');
const runArguments = buildVscodeTestArguments(coreTestFiles, process.argv.slice(2));
execFileSync(process.execPath, [vscodeTestCli, ...runArguments], {
  cwd: repositoryDirectory,
  stdio: 'inherit',
});
