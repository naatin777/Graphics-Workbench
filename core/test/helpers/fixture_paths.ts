import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findRepositoryRoot } from '../../../test-support/repository_root.js';

export {
  listFixtureFilePaths as listInputFixturePaths,
  listFixtureFilePathsSync as listInputFixturePathsSync,
} from '../../../test-support/fixture_files.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRootDirectory = findRepositoryRoot(testDirectory);
export const testInputDirectory = path.join(repositoryRootDirectory, 'test', 'input');
export const testOutputDirectory = path.join(repositoryRootDirectory, 'test', 'output');
export const operationPngInputPath = path.join(testInputDirectory, 'valid', 'png', 'transparent-shapes.png');
export const operationPdfInputDirectory = path.join(testInputDirectory, 'valid', 'pdf');
export const operationDrawioInputDirectory = path.join(testInputDirectory, 'valid', 'drawio');
export const operationPathCompatibilitySvgInputPath = path.join(
  testInputDirectory,
  'valid',
  'svg',
  'transparent-shapes.svg',
);
export const invalidPreflightInputDirectory = path.join(testInputDirectory, 'invalid', 'pdf');
