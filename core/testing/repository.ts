import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Locates the repository root by walking up until the marker layout is found.
 * The testing kit is consumed from the built `dist/testing` layout by tests,
 * while typechecking reads the `testing` source layout, so the distance to
 * the repository root is not a constant; the marker-based walk keeps both
 * layouts working.
 */
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
