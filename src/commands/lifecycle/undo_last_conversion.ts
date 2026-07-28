import * as vscode from 'vscode';

import {
  cleanupConversionArtifacts,
  type ConversionArtifactRoot,
} from '../../operations/lifecycle/cleanup_conversion_artifacts.js';
import type { LineOutputChannel } from '../../operations/external_tools/external_tool_ascii_scratch.js';
import {
  createConversionUndoRecord,
  type ConversionOutput,
  type ConversionUndoRecord,
  undoConversionOutputs,
} from '../../operations/lifecycle/undo_last_conversion.js';

import type { CommandDependencies } from '../shared/command_dependencies.js';
import { userMessage } from '../shared/user_messages.js';

export const UNDO_LAST_CONVERSION_COMMAND = 'latex-graphics-helper.undoLastConversion';

const conversionHistory: ConversionUndoRecord[] = [];
let historyLock: Promise<void> = Promise.resolve();

export async function recordConversionForUndo(
  outputs: ConversionOutput[],
  outputChannel?: LineOutputChannel,
): Promise<string> {
  return withHistoryLock(async () => {
    let record: ConversionUndoRecord;

    try {
      record = await createConversionUndoRecord(outputs);
    } catch (error) {
      await cleanupConversionArtifacts(toArtifactRoots(outputs), outputChannel);
      throw error instanceof Error ? error : new Error(String(error));
    }

    conversionHistory.push(record);
    await cleanupConversionArtifacts(toArtifactRoots(record.outputs, true), outputChannel);
    return record.id;
  });
}

export async function undoLastConversionCommand(
  expectedId?: string,
  dependencies?: CommandDependencies,
): Promise<void> {
  await withHistoryLock(async () => {
    const outputChannel = dependencies?.outputChannel;
    try {
      const record = conversionHistory.at(-1);
      if (!record) {
        await vscode.window.showInformationMessage(userMessage('message.undo.none'));
        return;
      }

      if (expectedId !== undefined && expectedId !== '' && expectedId !== record.id) {
        await vscode.window.showWarningMessage(userMessage('message.undo.newerConversionCompleted'));
        return;
      }

      await undoConversionOutputs(record, outputChannel);
      conversionHistory.pop();
      await vscode.window.showInformationMessage(userMessage('message.undo.removedLastOutput'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(userMessage('message.undo.failed', message));
    }
  });
}

async function withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = historyLock;
  let release!: () => void;
  historyLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;

  try {
    return await operation();
  } finally {
    release();
  }
}

function toArtifactRoots(
  outputs: readonly ConversionOutput[] | undefined,
  preserveBackups = false,
): ConversionArtifactRoot[] {
  return (
    outputs?.flatMap((output) =>
      output.stagingRootPath !== undefined && output.stagingRootPath !== ''
        ? [
            {
              rootPath: output.stagingRootPath,
              workspacePath: output.workspacePath,
              ...(preserveBackups && output.previousFilePath !== undefined
                ? { preservePaths: [output.previousFilePath] }
                : {}),
            },
          ]
        : [],
    ) ?? []
  );
}
