import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isRecord } from '../../shared/protocols/protocol_utils.js';

const STAGING_PREFIX = 'graphics-workbench-pdf-';
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
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

/** Refreshes the manifest while a sensitive PDF operation is still active. */
export function startSecurePdfStagingHeartbeat(rootPath: string): { dispose: () => void } {
  const interval = setInterval(() => {
    void touchSecurePdfStagingRoot(rootPath);
  }, HEARTBEAT_INTERVAL_MS);
  interval.unref();
  void touchSecurePdfStagingRoot(rootPath);
  return {
    dispose: () => {
      clearInterval(interval);
    },
  };
}

async function touchSecurePdfStagingRoot(rootPath: string): Promise<void> {
  const manifestPath = path.join(rootPath, 'manifest.json');
  try {
    // oxlint-disable-next-line typescript/no-restricted-types -- 外部マニフェストJSONの未検証値。直後にisStagingManifestで検証する。
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!isStagingManifest(parsed)) {
      return;
    }
    await writeFile(manifestPath, JSON.stringify({ ...parsed, updatedAt: Date.now() }), { mode: 0o600 });
  } catch {
    // The operation will fail or cleanup will retry if the secure root disappears.
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
          // oxlint-disable-next-line typescript/no-restricted-types -- 外部マニフェストJSONの未検証値。直後にisStagingManifestで検証する。
          const parsed: unknown = JSON.parse(await readFile(path.join(rootPath, 'manifest.json'), 'utf8'));
          if (isStagingManifest(parsed)) {
            manifest = parsed;
          }
        } catch {
          // A root created immediately before a crash has no usable manifest; age is the fallback guard.
        }

        const heartbeatAt = manifest?.updatedAt ?? manifest?.startedAt ?? 0;
        const age = heartbeatAt > 0 ? now - heartbeatAt : await rootAge(rootPath, now);
        // PID is not an ownership proof: it can be reused by an unrelated process.
        // Active operations keep this timestamp fresh through the heartbeat.
        if (age < STALE_AFTER_MS) {
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

// oxlint-disable-next-line typescript/no-restricted-types -- 外部マニフェストJSONの未検証値の形状を検証する型ガード。
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

async function rootAge(rootPath: string, now: number): Promise<number> {
  try {
    const rootStat = await stat(rootPath);
    return now - rootStat.mtimeMs;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
