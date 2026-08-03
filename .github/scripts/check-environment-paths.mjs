import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { findEnvironmentSpecificPaths } from './environment-paths.mjs';

const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean);

let failed = false;

for (const file of trackedFiles) {
  const content = readFileSync(resolve(repositoryRoot, file));

  // Binary files are not useful for this text-oriented policy check.
  if (content.includes(0)) {
    continue;
  }

  for (const finding of findEnvironmentSpecificPaths(content.toString('utf8'))) {
    process.stderr.write(`${file}:${finding.line}: ${finding.label}\n`);
    failed = true;
  }
}

if (failed) {
  process.stderr.write('Environment-specific absolute paths are not allowed in tracked files.\n');
  process.exitCode = 1;
}
