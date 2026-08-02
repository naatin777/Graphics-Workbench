import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export interface WorkspaceSnapshot {
  files: ReadonlyMap<string, Buffer>;
}

export interface WorkspaceChanges {
  created?: readonly string[];
  modified?: readonly string[];
  deleted?: readonly string[];
}

export async function captureWorkspaceSnapshot(rootPath: string): Promise<WorkspaceSnapshot> {
  const files = new Map<string, Buffer>();
  await collectFiles(rootPath, rootPath, files);
  return { files };
}

export function assertWorkspaceChangesSince(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  expected: WorkspaceChanges,
): void {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [relativePath, content] of after.files) {
    const previous = before.files.get(relativePath);
    if (previous === undefined) {
      created.push(relativePath);
    } else if (!previous.equals(content)) {
      modified.push(relativePath);
    }
  }

  for (const relativePath of before.files.keys()) {
    if (!after.files.has(relativePath)) {
      deleted.push(relativePath);
    }
  }

  assert.deepStrictEqual(created.toSorted(), (expected.created ?? []).toSorted(), 'Unexpected created files.');
  assert.deepStrictEqual(modified.toSorted(), (expected.modified ?? []).toSorted(), 'Unexpected modified files.');
  assert.deepStrictEqual(deleted.toSorted(), (expected.deleted ?? []).toSorted(), 'Unexpected deleted files.');
}

async function collectFiles(rootPath: string, currentPath: string, files: Map<string, Buffer>): Promise<void> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await collectFiles(rootPath, entryPath, files);
        return;
      }
      if (!entry.isFile()) {
        return;
      }

      files.set(path.relative(rootPath, entryPath), await readFile(entryPath));
    }),
  );
}
