import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  assertExistingPathInWorkspace,
  assertPathIsNotSymbolicLink,
  assertWritablePathInWorkspace,
} from '@graphics-workbench/core/security';

import {
  cleanupConversionArtifacts,
  hashFile,
  restoreFileMetadata,
  type CleanupResult,
  type ConversionArtifactRoot,
  type PreviousFileMetadata,
} from '@graphics-workbench/core/runtime';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';

export interface ConversionOutput {
  outputPath: string;
  workspacePath: string;
  /** Expected committed contents, when the output came from the commit coordinator. */
  sha256?: string;
  previousFilePath?: string;
  previousFileMetadata?: PreviousFileMetadata;
  stagingRootPath?: string;
  stagingWorkspacePath?: string;
}

export interface ConversionUndoRecord {
  id: string;
  createdAt: number;
  outputs: ConversionUndoOutput[];
}

export interface UndoConversionOutputsTestOverrides {
  removeRollbackRoot?: typeof rm;
}

export class UndoCleanupError extends Error {
  readonly originalError: Error;
  readonly cleanupResult: CleanupResult;

  // oxlint-disable-next-line typescript/no-restricted-types -- catchブロックから渡される任意のthrow値を正規化して保持する。
  constructor(originalError: unknown, cleanupResult: CleanupResult) {
    const normalizedError = originalError instanceof Error ? originalError : new Error(String(originalError));
    super(normalizedError.message, { cause: normalizedError });
    this.name = 'UndoCleanupError';
    this.originalError = normalizedError;
    this.cleanupResult = cleanupResult;
  }
}

interface ConversionUndoOutput extends ConversionOutput {
  sha256: string;
  previousSha256?: string;
}

interface RollbackCopy {
  output: ConversionUndoOutput;
  rollbackPath: string;
  rollbackRootPath: string;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

interface ValidatedUndoPaths {
  outputIdentity: FileIdentity;
  previousIdentity?: FileIdentity;
}

type RollbackRequirement = { kind: 'none' } | { kind: 'restore'; currentOutputIdentity?: FileIdentity };

type RollbackCandidate = { phase: 'applying'; snapshot: RollbackCopy } | { phase: 'applied'; snapshot: RollbackCopy };

export async function createConversionUndoRecord(
  outputs: ConversionOutput[],
  now: () => number = Date.now,
): Promise<ConversionUndoRecord> {
  if (outputs.length === 0) {
    throw new Error('No input outputs were provided.');
  }

  const uniquePaths = new Set<string>();
  const recordedOutputs = await Promise.all(
    outputs.map(async (output) => {
      const normalizedPath = path.resolve(output.outputPath);

      if (uniquePaths.has(normalizedPath)) {
        throw new Error(`Duplicate input output: ${output.outputPath}`);
      }
      uniquePaths.add(normalizedPath);

      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
      await assertPathIsNotSymbolicLink(output.outputPath);
      const currentSha256 = await calculateSha256(output.outputPath);
      if (output.sha256 !== undefined && currentSha256 !== output.sha256) {
        throw new Error(`Output changed before Undo could be recorded: ${output.outputPath}`);
      }
      const previousSha256 =
        output.previousFilePath !== undefined && output.previousFilePath !== ''
          ? await recordPreviousFile(output.previousFilePath, output.stagingWorkspacePath ?? output.workspacePath)
          : undefined;

      return {
        ...output,
        sha256: output.sha256 ?? currentSha256,
        ...(previousSha256 !== undefined && { previousSha256 }),
      };
    }),
  );

  return {
    id: crypto.randomUUID(),
    createdAt: now(),
    outputs: recordedOutputs,
  };
}

export async function undoConversionOutputs(
  record: ConversionUndoRecord,
  outputChannel?: LineOutputChannel,
  testOverrides: UndoConversionOutputsTestOverrides = {},
): Promise<CleanupResult> {
  await Promise.all(record.outputs.map(validateUnchangedOutput));
  const removeRollbackRoot = testOverrides.removeRollbackRoot ?? rm;
  const rollbackCopies = await createRollbackCopies(record, outputChannel, removeRollbackRoot);
  const rollbackCopiesByOutput = new Map(rollbackCopies.map((snapshot) => [snapshot.output, snapshot]));
  const rollbackCandidates: RollbackCandidate[] = [];

  try {
    for (const output of record.outputs) {
      // 検証後の差し替え時間を短くするため、削除直前にも同じ条件を確認する。
      const validatedPaths = await validateUnchangedOutput(output);
      const snapshot = rollbackCopiesByOutput.get(output);
      if (snapshot === undefined) {
        throw new Error(`No Undo rollback copy for output: ${output.outputPath}`);
      }
      const candidateIndex = rollbackCandidates.length;
      rollbackCandidates.push({ phase: 'applying', snapshot });
      await assertUndoPathsStillValid(output, validatedPaths);

      if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
        await copyFile(output.previousFilePath, output.outputPath);
        await restoreFileMetadata(output.outputPath, output.previousFileMetadata);
      } else {
        await rm(output.outputPath);
      }

      rollbackCandidates[candidateIndex] = { phase: 'applied', snapshot };
    }
  } catch (error) {
    try {
      await restoreRollbackCandidates(rollbackCandidates, outputChannel);
    } catch (rollbackError) {
      const incompleteRollback = new Error(`Undo failed and rollback was incomplete: ${String(error)}`, {
        cause: rollbackError,
      });
      throw new UndoCleanupError(incompleteRollback, preservedRollbackCopiesResult(rollbackCopies, rollbackError));
    }
    // ロールバック復元に成功した場合のみコピーを破棄する。復元できなかった出力の
    // 唯一の生存コピーが削除されるのを防ぐため、失敗時は保留する。
    const rollbackCleanup = await removeRollbackCopies(rollbackCopies, outputChannel, removeRollbackRoot);
    if (rollbackCleanup.failures.length > 0) {
      throw new UndoCleanupError(error, rollbackCleanup);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }

  const rollbackCleanup = await removeRollbackCopies(rollbackCopies, outputChannel, removeRollbackRoot);
  const artifactCleanup = await cleanupConversionArtifacts(toArtifactRoots(record), outputChannel);
  return mergeCleanupResults(rollbackCleanup, artifactCleanup);
}

async function removeRollbackCopies(
  rollbackCopies: readonly { rollbackRootPath: string }[],
  outputChannel?: LineOutputChannel,
  rmImpl: typeof rm = rm,
): Promise<CleanupResult> {
  const rollbackRootPaths = new Set(rollbackCopies.map((copy) => copy.rollbackRootPath));
  const failures: { rootPath: string; error: Error }[] = [];

  for (const rollbackRootPath of rollbackRootPaths) {
    try {
      await rmImpl(rollbackRootPath, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 200,
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      failures.push({ rootPath: rollbackRootPath, error: normalizedError });
      appendLineBestEffort(outputChannel, `[undo] cleanup failed for ${rollbackRootPath}: ${normalizedError.message}`);
    }
  }

  return {
    attempted: rollbackRootPaths.size,
    succeeded: rollbackRootPaths.size - failures.length,
    failures,
  };
}

function mergeCleanupResults(...results: readonly CleanupResult[]): CleanupResult {
  return {
    attempted: results.reduce((total, result) => total + result.attempted, 0),
    succeeded: results.reduce((total, result) => total + result.succeeded, 0),
    failures: results.flatMap((result) => result.failures),
  };
}

async function createRollbackCopies(
  record: ConversionUndoRecord,
  outputChannel?: LineOutputChannel,
  removeRollbackRoot: typeof rm = rm,
): Promise<RollbackCopy[]> {
  const rollbackCopies: RollbackCopy[] = [];

  try {
    const rollbackId = crypto.randomUUID();
    for (const [index, output] of record.outputs.entries()) {
      const rollbackRootPath = path.join(output.workspacePath, '.graphics-workbench', 'undo-rollback', rollbackId);
      const rollbackPath = path.join(rollbackRootPath, `${index}.backup`);
      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
      await assertWritablePathInWorkspace(rollbackRootPath, output.workspacePath);
      await mkdir(rollbackRootPath, { recursive: true });
      await copyFile(output.outputPath, rollbackPath);
      rollbackCopies.push({ output, rollbackPath, rollbackRootPath });
    }
    return rollbackCopies;
  } catch (error) {
    const cleanupResult = await removeRollbackCopies(rollbackCopies, outputChannel, removeRollbackRoot);
    if (cleanupResult.failures.length > 0) {
      throw new UndoCleanupError(error, cleanupResult);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function preservedRollbackCopiesResult(
  rollbackCopies: readonly { rollbackRootPath: string }[],
  // oxlint-disable-next-line typescript/no-restricted-types -- ロールバック復元のcatchから渡される任意のthrow値。
  rollbackError: unknown,
): CleanupResult {
  const rootPaths = new Set(rollbackCopies.map((copy) => copy.rollbackRootPath));
  const cause = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
  return {
    attempted: rootPaths.size,
    succeeded: 0,
    failures: [...rootPaths].map((rootPath) => ({
      rootPath,
      error: new Error('Undo recovery copy was retained because rollback was incomplete.', { cause }),
    })),
  };
}

async function restoreRollbackCandidates(
  candidates: readonly RollbackCandidate[],
  outputChannel?: LineOutputChannel,
): Promise<void> {
  const failures: { outputPath: string; error: Error }[] = [];

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate === undefined) {
      continue;
    }

    const { output, rollbackPath, rollbackRootPath } = candidate.snapshot;
    try {
      await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);
      let requirement: RollbackRequirement;
      if (candidate.phase === 'applied') {
        requirement = await assertAppliedUndoStateUnchanged(output);
      } else {
        requirement = await rollbackRequirementForApplyingOutput(output);
      }
      if (requirement.kind === 'none') {
        continue;
      }

      await assertExistingPathInWorkspace(rollbackPath, output.workspacePath);
      await assertPathIsNotSymbolicLink(rollbackPath);
      const flags =
        output.previousFilePath === undefined || output.previousFilePath === '' ? fsConstants.COPYFILE_EXCL : undefined;
      if (requirement.currentOutputIdentity === undefined) {
        await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);
      } else {
        await assertFileIdentityAtPath(output.outputPath, output.workspacePath, requirement.currentOutputIdentity);
      }
      await copyFile(rollbackPath, output.outputPath, flags);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      failures.push({ outputPath: output.outputPath, error: normalizedError });
      appendLineBestEffort(
        outputChannel,
        `[undo] rollback failed for ${output.outputPath}: ${normalizedError.message}; recovery copy: ${rollbackPath}`,
      );
      appendLineBestEffort(outputChannel, `[undo] preserving Undo recovery directory: ${rollbackRootPath}`);
    }
  }

  if (failures.length > 0) {
    const details = failures.map(({ outputPath, error }) => `${outputPath}: ${error.message}`).join('; ');
    throw new Error(`Undo rollback failed: ${details}`, { cause: failures[0]?.error });
  }
}

async function rollbackRequirementForApplyingOutput(output: ConversionUndoOutput): Promise<RollbackRequirement> {
  if (output.previousFilePath === undefined || output.previousFilePath === '') {
    try {
      await access(output.outputPath);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return { kind: 'restore' };
      }
      throw error instanceof Error ? error : new Error(String(error));
    }

    const current = await readValidatedDigest(output.outputPath, output.workspacePath);
    if (current.sha256 === output.sha256) {
      return { kind: 'none' };
    }
    throw new Error(`Output changed while Undo was being applied: ${output.outputPath}`);
  }

  const current = await readValidatedDigest(output.outputPath, output.workspacePath);
  if (current.sha256 === output.sha256) {
    return { kind: 'none' };
  }
  if (output.previousSha256 !== undefined && current.sha256 === output.previousSha256) {
    return { kind: 'restore', currentOutputIdentity: current.identity };
  }

  throw new Error(`Output changed while Undo was being applied: ${output.outputPath}`);
}

async function assertAppliedUndoStateUnchanged(output: ConversionUndoOutput): Promise<RollbackRequirement> {
  if (output.previousFilePath === undefined || output.previousFilePath === '') {
    return { kind: 'restore' };
  }

  const current = await readValidatedDigest(output.outputPath, output.workspacePath);
  if (output.previousSha256 === undefined || current.sha256 !== output.previousSha256) {
    throw new Error(`Output changed after Undo restoration: ${output.outputPath}`);
  }
  return { kind: 'restore', currentOutputIdentity: current.identity };
}

async function validateUnchangedOutput(output: ConversionUndoOutput): Promise<ValidatedUndoPaths> {
  let previousIdentity: FileIdentity | undefined;
  if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
    const previous = await readValidatedDigest(
      output.previousFilePath,
      output.stagingWorkspacePath ?? output.workspacePath,
    );

    if (previous.sha256 !== output.previousSha256) {
      throw new Error(`Output backup changed after input: ${output.previousFilePath}`);
    }
    previousIdentity = previous.identity;
  }

  // Check the user-visible output last so the mutation that follows starts with
  // the smallest practical validation-to-write window.
  const current = await readValidatedDigest(output.outputPath, output.workspacePath);

  if (current.sha256 !== output.sha256) {
    throw new Error(`Output changed after input: ${output.outputPath}`);
  }
  return {
    outputIdentity: current.identity,
    ...(previousIdentity === undefined ? {} : { previousIdentity }),
  };
}

async function assertUndoPathsStillValid(output: ConversionUndoOutput, validated: ValidatedUndoPaths): Promise<void> {
  await assertFileIdentityAtPath(output.outputPath, output.workspacePath, validated.outputIdentity);
  if (
    output.previousFilePath !== undefined &&
    output.previousFilePath !== '' &&
    validated.previousIdentity !== undefined
  ) {
    await assertFileIdentityAtPath(
      output.previousFilePath,
      output.stagingWorkspacePath ?? output.workspacePath,
      validated.previousIdentity,
    );
  }
}

async function readValidatedDigest(
  filePath: string,
  workspacePath: string,
): Promise<{ sha256: string; identity: FileIdentity }> {
  try {
    await assertExistingPathInWorkspace(filePath, workspacePath);
    await assertPathIsNotSymbolicLink(filePath);
    const before = await readFileIdentity(filePath);
    const sha256 = await calculateSha256(filePath);
    await assertExistingPathInWorkspace(filePath, workspacePath);
    await assertPathIsNotSymbolicLink(filePath);
    const identity = await readFileIdentity(filePath);
    if (!sameFileIdentity(before, identity)) {
      throw new Error(`File was replaced while its contents were being verified: ${filePath}`);
    }
    return { sha256, identity };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new Error(`File was replaced while its contents were being verified: ${filePath}`, { cause: error });
    }
    throw error instanceof Error ? error : new Error(String(error), { cause: error });
  }
}

async function assertFileIdentityAtPath(
  filePath: string,
  workspacePath: string,
  expected: FileIdentity,
): Promise<void> {
  await assertExistingPathInWorkspace(filePath, workspacePath);
  await assertPathIsNotSymbolicLink(filePath);
  if (!sameFileIdentity(await readFileIdentity(filePath), expected)) {
    throw new Error(`File was replaced before mutation: ${filePath}`);
  }
}

async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  const fileStat = await stat(filePath);
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function recordPreviousFile(previousFilePath: string, workspacePath: string): Promise<string> {
  await assertExistingPathInWorkspace(previousFilePath, workspacePath);
  await assertPathIsNotSymbolicLink(previousFilePath);
  return calculateSha256(previousFilePath);
}

async function calculateSha256(filePath: string): Promise<string> {
  return hashFile(filePath);
}

function toArtifactRoots(record: ConversionUndoRecord): ConversionArtifactRoot[] {
  return record.outputs.flatMap((output) =>
    output.stagingRootPath !== undefined && output.stagingRootPath !== ''
      ? [
          {
            rootPath: output.stagingRootPath,
            workspacePath: output.stagingWorkspacePath ?? output.workspacePath,
          },
        ]
      : [],
  );
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchブロックから渡される任意のthrow値の型ガード。
function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function appendLineBestEffort(outputChannel: LineOutputChannel | undefined, line: string): void {
  try {
    outputChannel?.appendLine(line);
  } catch {
    // Diagnostics must not interrupt rollback or cleanup.
  }
}
