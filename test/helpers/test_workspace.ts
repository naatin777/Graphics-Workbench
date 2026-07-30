import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { testWorkspaceDirectory } from './fixture_paths.js';

export async function withTestWorkspace<T>(callback: (workspacePath: string) => Promise<T>): Promise<T> {
  await clearTestWorkspace();
  await assertTestWorkspaceIsEmpty();

  try {
    return await callback(testWorkspaceDirectory);
  } finally {
    await clearTestWorkspace();
    await assertTestWorkspaceIsEmpty();
  }
}

export async function copyInputToWorkspace(inputPath: string, relativeDestinationPath: string): Promise<string> {
  const destinationPath = resolveWorkspacePath(relativeDestinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(inputPath, destinationPath);
  return destinationPath;
}

async function clearTestWorkspace(): Promise<void> {
  await mkdir(testWorkspaceDirectory, { recursive: true });
  const entries = await readdir(testWorkspaceDirectory, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      rm(path.join(testWorkspaceDirectory, entry.name), { recursive: entry.isDirectory(), force: true }),
    ),
  );
}

async function assertTestWorkspaceIsEmpty(): Promise<void> {
  const entries = await readdir(testWorkspaceDirectory);
  assert.deepStrictEqual(entries, [], 'test/workspace must be empty at the test boundary');
}

function resolveWorkspacePath(relativePath: string): string {
  const destinationPath = path.resolve(testWorkspaceDirectory, relativePath);
  const relativeToWorkspace = path.relative(testWorkspaceDirectory, destinationPath);

  if (
    relativeToWorkspace === '' ||
    relativeToWorkspace.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToWorkspace)
  ) {
    throw new Error(`Workspace destination must be inside test/workspace: ${relativePath}`);
  }

  return destinationPath;
}
