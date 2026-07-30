import { readdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

const testRootDirectory: string = path.resolve(testDirectory, '..', '..', '..', 'test');
export const testInputDirectory: string = path.join(testRootDirectory, 'input');
export const testOutputDirectory: string = path.join(testRootDirectory, 'output');
export const testWorkspaceDirectory: string = path.join(testRootDirectory, 'workspace');
const testOperationInputDirectory: string = path.join(testInputDirectory, 'valid', 'operations');
export const operationPngInputPath = path.join(testOperationInputDirectory, 'png', 'test.png');
export const operationEpsInputPath = path.join(testOperationInputDirectory, 'eps', 'minimal.eps');
export const operationPdfInputDirectory = path.join(testOperationInputDirectory, 'pdf-operations');
export const operationPdfOutputDirectory = path.join(testOutputDirectory, 'pdf', 'pdf-operations');
export const operationPathCompatibilitySvgInputPath = path.join(
  testOperationInputDirectory,
  'path-compatibility',
  'source.svg',
);
export const validPreflightInputDirectory = path.join(testOperationInputDirectory, 'preflight');
export const invalidPreflightInputDirectory = path.join(testInputDirectory, 'invalid', 'operations', 'preflight');

export async function listInputFixturePaths(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath: string = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listInputFixturePaths(entryPath);
      }
      if (entry.isFile() && entry.name !== '.DS_Store' && !entry.name.endsWith('.json')) {
        return [entryPath];
      }
      return [];
    }),
  );

  return paths.flat().toSorted();
}

export function listInputFixturePathsSync(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath: string = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listInputFixturePathsSync(entryPath);
      }
      return entry.isFile() && entry.name !== '.DS_Store' && !entry.name.endsWith('.json') ? [entryPath] : [];
    })
    .toSorted();
}
