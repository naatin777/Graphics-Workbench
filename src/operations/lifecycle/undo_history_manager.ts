import path from 'node:path';

import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';
import { cleanupConversionArtifacts, type ConversionArtifactRoot } from './cleanup_conversion_artifacts.js';
import {
  createConversionUndoRecord,
  type ConversionOutput,
  type ConversionUndoRecord,
  undoConversionOutputs,
} from './undo_last_conversion.js';

const DEFAULT_UNDO_RECORDS_LIMIT = 10;

export type UndoOutcome = 'no-record' | 'newer-input' | 'done';

/**
 * Owns the in-memory Undo history and the lifecycle of its staged backups.
 *
 * History lives only for the current extension-host session. Records are kept
 * in LIFO order and bounded by a configurable count: adding a record beyond the
 * limit evicts the oldest one and removes every staged backup it no longer
 * needs. Nothing is persisted, so after a reload/restart the history is empty.
 */
export class UndoHistoryManager {
  readonly #records: ConversionUndoRecord[] = [];
  #maxRecords: number;
  #historyLock: Promise<void> = Promise.resolve();

  constructor(maxRecords: number = DEFAULT_UNDO_RECORDS_LIMIT) {
    this.#maxRecords = assertValidRecordLimit(maxRecords);
  }

  /** Updates the history limit. Excess records are evicted on the next operation. */
  setMaxRecords(maxRecords: number): void {
    this.#maxRecords = assertValidRecordLimit(maxRecords);
  }

  async record(outputs: ConversionOutput[], outputChannel?: LineOutputChannel): Promise<string> {
    return this.#withHistoryLock(async () => {
      let record: ConversionUndoRecord;

      try {
        record = await createConversionUndoRecord(outputs);
      } catch (error) {
        // record作成に失敗しても、`.previous`（変換前のオリジナルの唯一のコピー）は
        // 削除しない。成功パスと同じくpreserveBackups=trueでstaging rootを掃除する。
        await cleanupConversionArtifacts(toArtifactRoots(outputs, true), outputChannel);
        throw error instanceof Error ? error : new Error(String(error));
      }

      this.#records.push(record);
      await this.#evict(outputChannel);
      await cleanupConversionArtifacts(toArtifactRoots(record.outputs, true), outputChannel);
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
        return 'newer-input';
      }

      await undoConversionOutputs(record, outputChannel);
      this.#records.pop();
      await this.#evict(outputChannel);
      return 'done';
    });
  }

  async #evict(outputChannel?: LineOutputChannel): Promise<void> {
    const evicted: ConversionUndoRecord[] = [];

    while (this.#records.length > this.#maxRecords) {
      const record = this.#records.shift();

      if (record !== undefined) {
        evicted.push(record);
      }
    }

    for (const record of evicted) {
      await cleanupConversionArtifacts(toArtifactRoots(record.outputs), outputChannel);
    }
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
              ? { preservePaths: [output.previousFilePath, path.join(output.stagingRootPath, 'manifest.json')] }
              : {}),
          },
        ]
      : [],
  );
}

function assertValidRecordLimit(maxRecords: number): number {
  if (!Number.isInteger(maxRecords) || maxRecords < 1) {
    throw new Error(`Invalid Undo history limit: ${maxRecords}`);
  }
  return maxRecords;
}
