import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from '../../application/protocols/protocol_utils.js';

const STAGING_PREFIX = 'graphics-workbench-pdf-';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

interface StagingManifest {
  pid: number;
  startedAt: number;
  operation: string;
}

/** Creates a user-scoped temporary root for sensitive PDF intermediates. */
export async function createSecurePdfStagingRoot(operation: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), STAGING_PREFIX));
  await chmod(rootPath, 0o700).catch(() => {
    // Windows uses the ACL inherited from the per-user temporary directory.
  });

  const manifest: StagingManifest = { pid: process.pid, startedAt: Date.now(), operation };
  await writeFile(path.join(rootPath, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
  return rootPath;
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
        // Never remove a root owned by a live extension host, even when an
        // additional window is activated much later. A manifest-less root is
        // retained until it is old enough to rule out a concurrent creator.
        if (processIsAlive || age < STALE_AFTER_MS) {
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
  return typeof value.pid === 'number' && typeof value.startedAt === 'number' && typeof value.operation === 'string';
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
