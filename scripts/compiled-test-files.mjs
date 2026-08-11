import { readdirSync } from 'node:fs';
import path from 'node:path';

export function collectCompiledTestFiles(rootDirectory, directory, excludedFileNames = new Set()) {
  const files = [];
  collect(directory, files);
  return files.toSorted(comparePaths);

  function collect(relativeDirectory, output) {
    for (const entry of readdirSync(path.join(rootDirectory, relativeDirectory), { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        collect(relativePath, output);
      } else if (entry.isFile() && entry.name.endsWith('.test.js') && !excludedFileNames.has(entry.name)) {
        output.push(relativePath);
      }
    }
  }
}

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildVscodeTestArguments(testFiles, forwardedArguments = []) {
  return [...testFiles.flatMap((testFile) => ['--run', testFile]), ...forwardedArguments];
}
