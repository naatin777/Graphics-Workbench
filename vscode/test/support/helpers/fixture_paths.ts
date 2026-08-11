import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepositoryRoot } from '../../../../test-support/repository_root.js';

export {
  listFixtureFilePaths as listInputFixturePaths,
  listFixtureFilePathsSync as listInputFixturePathsSync,
} from '../../../../test-support/fixture_files.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

export const projectRootDirectory = findRepositoryRoot(testDirectory);
const fixtureRootDirectory: string = path.join(projectRootDirectory, 'test');
const testSupportDirectory: string = path.join(projectRootDirectory, 'vscode', 'test', 'support');
export const testInputDirectory: string = path.join(fixtureRootDirectory, 'input');
export const testOutputDirectory: string = path.join(fixtureRootDirectory, 'output');
export const testWorkspaceDirectory: string = path.join(testSupportDirectory, 'workspace');
export const testVscodeSettingsPath: string = path.join(testSupportDirectory, 'vscode-settings', 'settings.json');
export const operationPngInputPath = path.join(testInputDirectory, 'valid', 'png', 'transparent-shapes.png');
export const operationPdfInputDirectory = path.join(testInputDirectory, 'valid', 'pdf');
export const operationDrawioInputDirectory = path.join(testInputDirectory, 'valid', 'drawio');
export const operationPdfOutputDirectory = path.join(testOutputDirectory, 'pdf', 'pdf-operations');
export const operationPathCompatibilitySvgInputPath = path.join(
  testInputDirectory,
  'valid',
  'svg',
  'transparent-shapes.svg',
);
export const invalidPreflightInputDirectory = path.join(testInputDirectory, 'invalid', 'pdf');
