import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from '../../shared/protocols/protocol_utils.js';

const STAGING_PREFIX = 'graphics-workbench-pdf-';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const SESSION_ID = randomUUID();
const EXTENSION_HOST_STARTED_AT = Date.now();

interface StagingManifest {
  sessionId: string;
  extensionHostStartedAt: number;
  pid: number;
  startedAt: number;
  updatedAt: number;
  operation: string;
  operationId: string;
}

/** Creates a user-scoped temporary root for sensitive PDF intermediates. */
export async function createSecurePdfStagingRoot(operation: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), STAGING_PREFIX));
  try {
    await (process.platform === 'win32'
      ? chmod(rootPath, 0o700).catch(() => {
          // Windows uses the ACL inherited from the per-user temporary directory.
        })
      : chmod(rootPath, 0o700));

    const now = Date.now();
    const manifest: StagingManifest = {
      sessionId: SESSION_ID,
      extensionHostStartedAt: EXTENSION_HOST_STARTED_AT,
      pid: process.pid,
      startedAt: now,
      updatedAt: now,
      operation,
      operationId: randomUUID(),
    };
    await writeFile(path.join(rootPath, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    return rootPath;
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true }).catch(() => {
      // Preserve the original permission or manifest error.
    });
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Removes abandoned sensitive staging roots from a previous extension-host process. */
export async function cleanupStaleSecurePdfStagingRoots(now: number = Date.now()): Promise<void> {
  let entries;
  try {
    entries = await readdir(os.tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(STAGING_PREFIX))
      .map(async (entry) => {
        const rootPath = path.join(os.tmpdir(), entry.name);
        if (!(await isOwnedSecureDirectory(rootPath))) {
          return;
        }
        let manifest: StagingManifest | undefined;
        try {
          const parsed: unknown = JSON.parse(await readFile(path.join(rootPath, 'manifest.json'), 'utf8'));
          if (isStagingManifest(parsed)) {
            manifest = parsed;
          }
        } catch {
          // A root created immediately before a crash has no usable manifest; age is the fallback guard.
        }

        const startedAt = manifest?.startedAt ?? 0;
        const processIsAlive = manifest?.pid !== undefined && isProcessAlive(manifest.pid);
        const age = startedAt > 0 ? now - startedAt : await rootAge(rootPath, now);
        // A live process can own a long-running input. Fixed retention is
        // only safe after its PID is no longer active.
        if (age < STALE_AFTER_MS || processIsAlive) {
          return;
        }

        await rm(rootPath, { recursive: true, force: true }).catch(() => {
          // Cleanup is best effort; the next activation retries it.
        });
      }),
  );
}

async function isOwnedSecureDirectory(rootPath: string): Promise<boolean> {
  try {
    const rootStat = await lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return false;
    }

    return process.getuid === undefined || rootStat.uid === process.getuid();
  } catch {
    return false;
  }
}

function isStagingManifest(value: unknown): value is StagingManifest {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.sessionId === 'string' &&
    typeof value.extensionHostStartedAt === 'number' &&
    typeof value.pid === 'number' &&
    typeof value.startedAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.operation === 'string' &&
    typeof value.operationId === 'string'
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function rootAge(rootPath: string, now: number): Promise<number> {
  try {
    const rootStat = await stat(rootPath);
    return now - rootStat.mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
