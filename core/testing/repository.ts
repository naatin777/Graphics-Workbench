import { existsSync } from 'node:fs';
import path from 'node:path';

export function findRepositoryRoot(startDirectory: string): string {
  let currentDirectory = path.resolve(startDirectory);

  while (true) {
    if (
      existsSync(path.join(currentDirectory, 'package.json')) &&
      existsSync(path.join(currentDirectory, 'core', 'package.json')) &&
      existsSync(path.join(currentDirectory, 'vscode', 'extension', 'package.json')) &&
      existsSync(path.join(currentDirectory, 'vscode', 'webview', 'package.json')) &&
      existsSync(path.join(currentDirectory, 'test', 'input'))
    ) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(`Could not find repository root from ${startDirectory}`);
    }
    currentDirectory = parentDirectory;
  }
}
