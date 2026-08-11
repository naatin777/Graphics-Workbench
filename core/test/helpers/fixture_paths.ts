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
export const operationPdfInputDirectory = path.join(testInputDirectory, 'valid', 'pdf');
