import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let workspaceDirectory: string | undefined;

async function resolveWorkspaceRoot(): Promise<string> {
  workspaceDirectory ??= await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-test-workspace-'));
  return workspaceDirectory;
}

export async function withTestWorkspace<T>(callback: (workspacePath: string) => Promise<T>): Promise<T> {
  const workspacePath = await resolveWorkspaceRoot();
  await clearWorkspace(workspacePath);

  try {
    return await callback(workspacePath);
  } finally {
    await clearWorkspace(workspacePath);
  }
}

export async function copyInputToWorkspace(inputPath: string, relativeDestinationPath: string): Promise<string> {
  const workspacePath = await resolveWorkspaceRoot();
  const destinationPath = path.join(workspacePath, relativeDestinationPath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(inputPath, destinationPath);
  return destinationPath;
}

async function clearWorkspace(workspacePath: string): Promise<void> {
  const entries = await readdir(workspacePath, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) => rm(path.join(workspacePath, entry.name), { recursive: entry.isDirectory(), force: true })),
  );
}
