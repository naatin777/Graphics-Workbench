import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';
import { cleanupConversionArtifacts, type ConversionArtifactRoot } from './cleanup_conversion_artifacts.js';
import {
  createConversionUndoRecord,
  type ConversionOutput,
  type ConversionUndoRecord,
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
 */
export class UndoHistoryManager {
  readonly #records: ConversionUndoRecord[] = [];
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
        await cleanupConversionArtifacts(toArtifactRoots(outputs), outputChannel);
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

      await undoConversionOutputs(record, outputChannel);
      this.#records.pop();
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

      if (staleEntries.length === 0) {
        return;
      }

      for (const entry of staleEntries) {
        await cleanupConversionArtifacts(toManifestArtifactRoots(entry), outputChannel);
      }

      await this.#writeManifest({
        version: MANIFEST_VERSION,
        entries: manifest.entries.filter((entry) => !staleEntries.includes(entry)),
      });
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
      await cleanupConversionArtifacts(toArtifactRoots(record.outputs), outputChannel);
    }
  }

  async #persistManifest(outputChannel?: LineOutputChannel): Promise<void> {
    if (this.#storage === undefined) {
      return;
    }

    try {
      await this.#writeManifest({
        version: MANIFEST_VERSION,
        entries: this.#records.map((record) => ({
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
      });
    } catch (error) {
      outputChannel?.appendLine(
        `[undo] manifest persist failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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

function toArtifactRoots(outputs: readonly ConversionOutput[], preserveBackups = false): ConversionArtifactRoot[] {
  return outputs.flatMap((output) =>
    output.stagingRootPath !== undefined && output.stagingRootPath !== ''
      ? [
          {
            rootPath: output.stagingRootPath,
            workspacePath: output.stagingWorkspacePath ?? output.workspacePath,
            ...(preserveBackups && output.previousFilePath !== undefined
              ? { preservePaths: [output.previousFilePath] }
              : {}),
          },
        ]
      : [],
  );
}

function toManifestArtifactRoots(entry: UndoManifestEntry): ConversionArtifactRoot[] {
  return entry.roots.map((root) => ({ rootPath: root.rootPath, workspacePath: root.workspacePath }));
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
