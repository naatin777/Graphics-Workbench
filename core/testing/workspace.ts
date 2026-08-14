import { copyFile, mkdir, mkdtempDisposable } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Runs the callback against a fresh, test-private temporary workspace that is
 * removed when the callback finishes. Tests never share a workspace, so
 * parallel execution cannot have one test deleting another test's files.
 */
export async function withTestWorkspace<T>(callback: (workspacePath: string) => Promise<T>): Promise<T> {
  await using workspace = await mkdtempDisposable(path.join(os.tmpdir(), 'graphics-workbench-test-workspace-'));
  return await callback(workspace.path);
}

export async function copyInputToWorkspace(
  inputPath: string,
  workspacePath: string,
  relativeDestinationPath: string,
): Promise<string> {
  const destinationPath = path.join(workspacePath, relativeDestinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(inputPath, destinationPath);
  return destinationPath;
}
