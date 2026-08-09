import path from 'node:path';

import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';
import {
  cleanupConversionArtifacts,
  type CleanupResult,
  type ConversionArtifactRoot,
} from './cleanup_conversion_artifacts.js';
import {
  createConversionUndoRecord,
  type ConversionOutput,
  type ConversionUndoRecord,
  UndoCleanupError,
  undoConversionOutputs,
} from './undo_last_conversion.js';

export const UNDO_HISTORY_MANIFEST_KEY = 'graphics-workbench.undoHistory';

const DEFAULT_MAX_RECORDS = 10;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MANIFEST_VERSION = 1;

export interface UndoManifestStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

interface UndoManifestRoot {
  workspacePath: string;
  rootPath: string;
}

interface UndoManifestEntry {
  id: string;
  createdAt: number;
  roots: UndoManifestRoot[];
}

interface UndoManifest {
  version: number;
  entries: UndoManifestEntry[];
}

export type UndoOutcome = 'no-record' | 'newer-conversion' | 'done';

export interface UndoHistoryManagerOptions {
  maxRecords?: number;
  retentionMs?: number;
  storage?: UndoManifestStorage;
  now?: () => number;
}

/**
 * Owns the in-memory Undo history and the lifecycle of its staged backups.
 *
 * Records are bounded by count and retention. Evicted records have their staged
 * backup roots removed. A manifest is persisted into workspaceState so that
 * orphaned backups from previous sessions (whose in-memory history is gone after
 * a restart) can be cleaned on the next activation.
 *
 * On restart the in-memory history is gone, so within-retention manifest entries
 * are kept as orphan candidates: they stay in the manifest on every persist and
 * are cleaned only once their retention expires.
 */
export class UndoHistoryManager {
  readonly #records: ConversionUndoRecord[] = [];
  #orphanedEntries: UndoManifestEntry[] = [];
  readonly #maxRecords: number;
  readonly #retentionMs: number;
  readonly #storage: UndoManifestStorage | undefined;
  readonly #now: () => number;
  #historyLock: Promise<void> = Promise.resolve();

  constructor(options: UndoHistoryManagerOptions = {}) {
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.#retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.#storage = options.storage;
    this.#now = options.now ?? Date.now;
  }

  async record(outputs: ConversionOutput[], outputChannel?: LineOutputChannel): Promise<string> {
    return this.#withHistoryLock(async () => {
      let record: ConversionUndoRecord;

      try {
        record = await createConversionUndoRecord(outputs, this.#now);
      } catch (error) {
        // record作成に失敗しても、`.previous`（変換前のオリジナルの唯一のコピー）は
        // 削除しない。成功パスと同じくpreserveBackups=trueでstaging rootを掃除する。
        await cleanupConversionArtifacts(toArtifactRoots(outputs, true), outputChannel);
        throw error instanceof Error ? error : new Error(String(error));
      }

      this.#records.push(record);
      await this.#evict(outputChannel);
      await cleanupConversionArtifacts(toArtifactRoots(record.outputs, true), outputChannel);
      await this.#persistManifest(outputChannel);
      return record.id;
    });
  }

  async undo(expectedId?: string, outputChannel?: LineOutputChannel): Promise<UndoOutcome> {
    return this.#withHistoryLock(async () => {
      const record = this.#records.at(-1);

      if (!record) {
        return 'no-record';
      }

      if (expectedId !== undefined && expectedId !== '' && expectedId !== record.id) {
        return 'newer-conversion';
      }

      let cleanupResult: CleanupResult;
      try {
        cleanupResult = await undoConversionOutputs(record, outputChannel);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        if (cause instanceof UndoCleanupError) {
          this.#retainCleanupFailures(record, cause.cleanupResult);
          await this.#persistManifest(outputChannel);
        }
        throw cause;
      }
      this.#records.pop();
      this.#retainCleanupFailures(record, cleanupResult);
      await this.#evict(outputChannel);
      await this.#persistManifest(outputChannel);
      return 'done';
    });
  }

  async initialize(outputChannel?: LineOutputChannel): Promise<void> {
    if (this.#storage === undefined) {
      return;
    }

    await this.#withHistoryLock(async () => {
      const manifest = this.#readManifest();
      const now = this.#now();
      const staleEntries = manifest.entries.filter((entry) => now - entry.createdAt > this.#retentionMs);
      const retainedEntries = manifest.entries.filter((entry) => !staleEntries.includes(entry));

      if (staleEntries.length > 0) {
        for (const entry of staleEntries) {
          const artifacts = toManifestArtifactRoots(entry);
          const result = await cleanupConversionArtifacts(artifacts, outputChannel);
          const failedRoots = failedArtifactRoots(artifacts, result);
          if (failedRoots.length > 0) {
            retainedEntries.push({ ...entry, roots: failedRoots.map((root) => toManifestRoot(root)) });
          }
        }

        await this.#writeManifest({
          version: MANIFEST_VERSION,
          entries: retainedEntries,
        });
      }

      const recordIds = new Set(this.#records.map((record) => record.id));
      this.#orphanedEntries = retainedEntries.filter((entry) => !recordIds.has(entry.id));
    });
  }

  async #evict(outputChannel?: LineOutputChannel): Promise<void> {
    const now = this.#now();
    const evicted: ConversionUndoRecord[] = [];

    while (this.#records.length > this.#maxRecords) {
      const record = this.#records.shift();

      if (record !== undefined) {
        evicted.push(record);
      }
    }

    while (this.#records[0] !== undefined && now - this.#records[0].createdAt > this.#retentionMs) {
      const record = this.#records.shift();

      if (record !== undefined) {
        evicted.push(record);
      }
    }

    for (const record of evicted) {
      const artifacts = toArtifactRoots(record.outputs);
      const result = await cleanupConversionArtifacts(artifacts, outputChannel);
      this.#retainCleanupFailures(record, result);
    }
  }

  async #persistManifest(outputChannel?: LineOutputChannel): Promise<void> {
    await this.#expireOrphans(outputChannel);

    if (this.#storage === undefined) {
      return;
    }

    try {
      await this.#writeManifest({
        version: MANIFEST_VERSION,
        entries: mergeManifestEntries([
          ...this.#records.map((record) => ({
            id: record.id,
            createdAt: record.createdAt,
            roots: record.outputs.flatMap((output) =>
              output.stagingRootPath !== undefined && output.stagingRootPath !== ''
                ? [
                    {
                      workspacePath: output.stagingWorkspacePath ?? output.workspacePath,
                      rootPath: output.stagingRootPath,
                    },
                  ]
                : [],
            ),
          })),
          ...this.#orphanedEntries,
        ]),
      });
    } catch (error) {
      outputChannel?.appendLine(
        `[undo] manifest persist failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async #expireOrphans(outputChannel?: LineOutputChannel): Promise<void> {
    const now = this.#now();
    const retained = this.#orphanedEntries.filter((entry) => now - entry.createdAt <= this.#retentionMs);
    const expired = this.#orphanedEntries.filter((entry) => now - entry.createdAt > this.#retentionMs);

    for (const entry of expired) {
      const artifacts = toManifestArtifactRoots(entry);
      const result = await cleanupConversionArtifacts(artifacts, outputChannel);
      const failedRoots = failedArtifactRoots(artifacts, result);
      if (failedRoots.length > 0) {
        retained.push({ ...entry, roots: failedRoots.map((root) => toManifestRoot(root)) });
      }
    }

    this.#orphanedEntries = retained;
  }

  #retainCleanupFailures(record: ConversionUndoRecord, result: CleanupResult): void {
    const artifacts = cleanupArtifactsForResult(record.outputs, result);
    const failedRoots = failedArtifactRoots(artifacts, result);
    if (failedRoots.length === 0) {
      return;
    }

    const retainedEntry = {
      id: record.id,
      createdAt: record.createdAt,
      roots: failedRoots.map((root) => toManifestRoot(root)),
    };
    const existingIndex = this.#orphanedEntries.findIndex((entry) => entry.id === record.id);
    if (existingIndex === -1) {
      this.#orphanedEntries.push(retainedEntry);
      return;
    }

    const existingEntry = this.#orphanedEntries[existingIndex];
    if (existingEntry === undefined) {
      this.#orphanedEntries.push(retainedEntry);
      return;
    }

    const [mergedEntry] = mergeManifestEntries([existingEntry, retainedEntry]);
    if (mergedEntry !== undefined) {
      this.#orphanedEntries[existingIndex] = mergedEntry;
    }
  }

  async #writeManifest(manifest: UndoManifest): Promise<void> {
    if (this.#storage === undefined) {
      return;
    }

    await this.#storage.update(UNDO_HISTORY_MANIFEST_KEY, manifest);
  }

  #readManifest(): UndoManifest {
    if (this.#storage === undefined) {
      return { version: MANIFEST_VERSION, entries: [] };
    }

    const value = this.#storage.get(UNDO_HISTORY_MANIFEST_KEY);

    if (!isUndoManifest(value)) {
      return { version: MANIFEST_VERSION, entries: [] };
    }

    return value;
  }

  async #withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#historyLock;
    let release!: () => void;
    this.#historyLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function cleanupArtifactsForResult(
  outputs: readonly ConversionOutput[],
  result: CleanupResult,
): ConversionArtifactRoot[] {
  const artifacts = toArtifactRoots(outputs);
  const knownRoots = new Set(artifacts.map((artifact) => path.resolve(artifact.rootPath)));

  for (const failure of result.failures) {
    const rootPath = path.resolve(failure.rootPath);
    if (knownRoots.has(rootPath)) {
      continue;
    }

    const workspacePath = outputs
      .flatMap((output) => [output.workspacePath, output.stagingWorkspacePath].filter((value) => value !== undefined))
      .find((boundary) => isPathWithin(rootPath, boundary));
    if (workspacePath !== undefined) {
      artifacts.push({ rootPath, workspacePath });
      knownRoots.add(rootPath);
    }
  }

  return artifacts;
}

function isPathWithin(targetPath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relativePath === '' || (!path.isAbsolute(relativePath) && !relativePath.startsWith(`..${path.sep}`));
}

function toArtifactRoots(outputs: readonly ConversionOutput[], preserveBackups = false): ConversionArtifactRoot[] {
  return outputs.flatMap((output) =>
    output.stagingRootPath !== undefined && output.stagingRootPath !== ''
      ? [
          {
            rootPath: output.stagingRootPath,
            workspacePath: output.stagingWorkspacePath ?? output.workspacePath,
            ...(preserveBackups && output.previousFilePath !== undefined
              ? { preservePaths: [output.previousFilePath, path.join(output.stagingRootPath, 'manifest.json')] }
              : {}),
          },
        ]
      : [],
  );
}

function toManifestArtifactRoots(entry: UndoManifestEntry): ConversionArtifactRoot[] {
  return entry.roots.map((root) => ({ rootPath: root.rootPath, workspacePath: root.workspacePath }));
}

function failedArtifactRoots(
  artifacts: readonly ConversionArtifactRoot[],
  result: CleanupResult,
): ConversionArtifactRoot[] {
  const failedRootPaths = new Set(result.failures.map((failure) => path.resolve(failure.rootPath)));
  return artifacts.filter((artifact) => failedRootPaths.has(path.resolve(artifact.rootPath)));
}

function toManifestRoot(artifact: ConversionArtifactRoot): UndoManifestRoot {
  return { rootPath: artifact.rootPath, workspacePath: artifact.workspacePath };
}

function mergeManifestEntries(entries: readonly UndoManifestEntry[]): UndoManifestEntry[] {
  const merged = new Map<string, UndoManifestEntry>();
  for (const entry of entries) {
    const current = merged.get(entry.id);
    if (current === undefined) {
      merged.set(entry.id, { ...entry, roots: [...entry.roots] });
      continue;
    }
    const roots = new Map(
      [...current.roots, ...entry.roots].map((root) => [
        `${path.resolve(root.workspacePath)}\0${path.resolve(root.rootPath)}`,
        root,
      ]),
    );
    merged.set(entry.id, {
      id: entry.id,
      createdAt: Math.min(current.createdAt, entry.createdAt),
      roots: [...roots.values()],
    });
  }
  return [...merged.values()];
}

function isUndoManifest(value: unknown): value is UndoManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { version?: unknown; entries?: unknown };
  return (
    candidate.version === MANIFEST_VERSION &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(isUndoManifestEntry)
  );
}

function isUndoManifestEntry(value: unknown): value is UndoManifestEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { id?: unknown; createdAt?: unknown; roots?: unknown };
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Array.isArray(candidate.roots) &&
    candidate.roots.every(isUndoManifestRoot)
  );
}

function isUndoManifestRoot(value: unknown): value is UndoManifestRoot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { workspacePath?: unknown; rootPath?: unknown };
  return typeof candidate.workspacePath === 'string' && typeof candidate.rootPath === 'string';
}
