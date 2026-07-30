import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

export const fixtureDirectory = path.resolve(testDirectory, '..', '..', '..', 'test', 'fixtures');
export const sourceFixtureDirectory = path.join(fixtureDirectory, 'source');
export const invalidFixtureDirectory = path.join(fixtureDirectory, 'invalid');

export async function listInputFixturePaths(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
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
