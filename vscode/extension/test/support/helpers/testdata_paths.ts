import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepositoryRoot } from '@graphics-workbench/core/testing';

export {
  invalidPreflightInputDirectory,
  listInputTestDataPaths,
  listInputTestDataPathsSync,
  operationDrawioInputDirectory,
  operationPdfInputDirectory,
  operationPngInputPath,
  operationSvgInputPath,
  testInputDirectory,
  testOutputDirectory,
} from '@graphics-workbench/core/testing';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRootDirectory = findRepositoryRoot(testDirectory);
const testSupportDirectory: string = path.join(projectRootDirectory, 'vscode', 'extension', 'test', 'support');
export const testWorkspaceDirectory: string = path.join(testSupportDirectory, 'workspace');
export const testVscodeSettingsPath: string = path.join(testSupportDirectory, 'vscode-settings', 'settings.json');
