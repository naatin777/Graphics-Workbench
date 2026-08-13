import { mkdir, readFile, readdir, rmdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import * as v from 'valibot';

const STAGING_ROOT_DIRECTORY = '.graphics-workbench';
const OWNER_MARKER_FILE = '.graphics-workbench-owner';

const OwnerMarkerSchema = v.strictObject({
  pid: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

/**
 * Marks a workspace staging root as owned by the current process. The marker
 * lets `cleanupStaleWorkspaceStagingRoots` distinguish live roots (a
 * concurrent headless conversion in the same workspace) from roots left
 * behind by a dead session, whose `.previous` backups would otherwise orphan
 * forever.
 */
export async function markStagingRootOwned(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, OWNER_MARKER_FILE), `${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
}

/**
 * Removes workspace staging roots whose owner process is no longer alive.
 *
 * Undo backups (`.previous`) intentionally outlive the conversion that
 * created them, but the Undo history itself is session-only, so once the
 * extension host is gone the backups can never be consumed. Anything under
 * `<workspace>/.graphics-workbench/<operation>/<runId>/` from a dead or
 * unmarked owner is therefore garbage and is reclaimed at the next
 * activation. Roots whose marker names a live process (e.g. a conversion
 * running in the same workspace from another client) are kept.
 */
export async function cleanupStaleWorkspaceStagingRoots(workspacePath: string): Promise<void> {
  const stagingRoot = path.join(workspacePath, STAGING_ROOT_DIRECTORY);
  const operationEntries = await readdir(stagingRoot, { withFileTypes: true }).catch(() => []);
  for (const operationEntry of operationEntries) {
    if (!operationEntry.isDirectory()) {
      continue;
    }
    const operationDirectory = path.join(stagingRoot, operationEntry.name);
    const runEntries = await readdir(operationDirectory, { withFileTypes: true }).catch(() => []);
    for (const runEntry of runEntries) {
      if (!runEntry.isDirectory()) {
        continue;
      }
      const runDirectory = path.join(operationDirectory, runEntry.name);
      if (!(await isOwnerAlive(runDirectory))) {
        await rm(runDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    // Remove the operation directory only when it no longer contains any runs;
    // rmdir fails on non-empty directories.
    await rmdir(operationDirectory).catch(() => undefined);
  }
}

async function isOwnerAlive(runDirectory: string): Promise<boolean> {
  const ownerPid = await readOwnerPid(path.join(runDirectory, OWNER_MARKER_FILE));
  if (ownerPid === undefined) {
    return false;
  }
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user: still alive.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function readOwnerPid(markerPath: string): Promise<number | undefined> {
  let content: string;
  try {
    content = await readFile(markerPath, 'utf8');
  } catch {
    return undefined;
  }
  // 他プロセスが書いた未検証JSONを境界でパースする。
  const parsed = v.safeParse(OwnerMarkerSchema, JSON.parse(content));
  return parsed.success ? parsed.output.pid : undefined;
}
