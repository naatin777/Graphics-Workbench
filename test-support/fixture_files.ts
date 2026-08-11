import { readdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export async function listFixtureFilePaths(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listFixtureFilePaths(entryPath);
      }
      if (entry.isFile() && entry.name !== '.DS_Store' && !entry.name.endsWith('.json')) {
        return [entryPath];
      }
      return [];
    }),
  );

  return paths.flat().toSorted();
}

export function listFixtureFilePathsSync(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        return listFixtureFilePathsSync(entryPath);
      }
      return entry.isFile() && entry.name !== '.DS_Store' && !entry.name.endsWith('.json') ? [entryPath] : [];
    })
    .toSorted();
}
