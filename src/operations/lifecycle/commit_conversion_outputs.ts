import { constants as fsConstants } from 'node:fs';
import { access, mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';

import {
  cleanupConversionArtifacts,
  type CleanupPreservingError,
  type ConversionArtifactRoot,
} from './cleanup_conversion_artifacts.js';
import { OperationCancelledError } from './operation_cancelled_error.js';
import { copyFileWithAbort, type AbortableCopyFile } from './copy_file_with_abort.js';
import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';
import { filesHaveEqualContents, hashFile } from '../input/file_content_hash.js';

export type OutputConflictDecision = 'keep-both' | 'cancel' | 'overwrite';

export interface PreparedConversionOutput {
  stagedOutputPath: string;
  outputPath: string;
  workspacePath: string;
  stagingRootPath?: string;
  /** Filesystem root that authorizes stagingRootPath and stagedOutputPath. */
  stagingWorkspacePath?: string | undefined;
  keepBothGroup?: {
    basePath: string;
    suffix: string;
  };
}

export interface CommittedConversionOutput {
  outputPath: string;
  workspacePath: string;
  previousFilePath?: string;
  stagingRootPath?: string;
  stagingWorkspacePath?: string | undefined;
}

export interface CommitConversionOutputsOptions {
  resolveConflicts?: (conflicts: string[]) => Promise<OutputConflictDecision>;
  signal?: AbortSignal;
  operationName?: string;
  outputChannel?: LineOutputChannel;
  copyFile?: AbortableCopyFile;
  rename?: typeof rename;
  rm?: typeof rm;
}

interface ResolvedOutput extends PreparedConversionOutput {
  previousFilePath?: string;
  existedBeforeCommit: boolean;
  contentHashBeforeConflict?: string;
  createdOutputIdentity?: FileIdentity;
  copyCompleted?: boolean;
}

interface ExistingOutputSnapshot {
  output: PreparedConversionOutput;
  contentHash: string;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

function stagingBoundary(output: PreparedConversionOutput): string {
  return output.stagingWorkspacePath ?? output.workspacePath;
}

export interface RollbackFailure {
  outputPath: string;
  error: Error;
}

export class CommitRollbackError extends Error implements CleanupPreservingError {
  readonly originalError: Error;
  readonly rollbackErrors: readonly RollbackFailure[];
  readonly cleanupPreservePaths: readonly string[];

  constructor(
    originalError: unknown,
    rollbackErrors: readonly RollbackFailure[],
    cleanupPreservePaths: readonly string[] = [],
  ) {
    const normalizedOriginalError = asError(originalError);
    const details = rollbackErrors.map(({ outputPath, error }) => `${outputPath}: ${error.message}`).join('; ');
    super(`Commit failed: ${normalizedOriginalError.message}; rollback failed: ${details}`);
    this.name = 'CommitRollbackError';
    this.originalError = normalizedOriginalError;
    this.rollbackErrors = rollbackErrors;
    this.cleanupPreservePaths = [...new Set(cleanupPreservePaths)];
  }
}

export { OperationCancelledError } from './operation_cancelled_error.js';

export async function commitStagedOutputs(
  outputs: PreparedConversionOutput[],
  options: CommitConversionOutputsOptions = {},
): Promise<CommittedConversionOutput[]> {
  let resolvedOutputs: ResolvedOutput[] = [];

  try {
    options.signal?.throwIfAborted();
    await validatePreparedOutputs(outputs);
    const normalizePath = await createPathNormalizer(outputs.map((output) => output.outputPath));
    assertUniqueRequestedOutputs(outputs, normalizePath);

    const conflicts = await findExistingOutputs(outputs);
    const decision = await resolveDecision(
      conflicts.map(({ output }) => output),
      options.resolveConflicts,
    );
    options.outputChannel?.appendLine(`[${options.operationName ?? 'conversion'}] conflict decision: ${decision}`);
    resolvedOutputs = await resolveOutputPaths(outputs, decision, conflicts, normalizePath);

    options.signal?.throwIfAborted();
    await assertConflictOutputsUnchanged(resolvedOutputs);
    await createBackups(resolvedOutputs, decision, options.copyFile ?? copyFileWithAbort, options.signal);
    options.signal?.throwIfAborted();

    return await commitResolvedOutputs(resolvedOutputs, options);
  } catch (error) {
    await cleanupConversionArtifacts(
      toArtifactRoots(resolvedOutputs.length > 0 ? resolvedOutputs : outputs),
      options.outputChannel,
      error,
    );
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function resolveDecision(
  conflicts: PreparedConversionOutput[],
  resolveConflicts?: (conflicts: string[]) => Promise<OutputConflictDecision>,
): Promise<OutputConflictDecision> {
  if (conflicts.length === 0) {
    return 'overwrite';
  }

  if (!resolveConflicts) {
    throw new Error(`Output file already exists: ${conflicts[0]?.outputPath}`);
  }

  const decision = await resolveConflicts(conflicts.map((item) => item.outputPath));

  if (decision === 'cancel') {
    throw new OperationCancelledError('Output conflict resolution was cancelled.');
  }

  return decision;
}

async function resolveOutputPaths(
  outputs: PreparedConversionOutput[],
  decision: OutputConflictDecision,
  conflicts: ExistingOutputSnapshot[],
  normalizePath: PathNormalizer,
): Promise<ResolvedOutput[]> {
  const reservedPaths = new Set(outputs.map((item) => normalizePath(item.outputPath)));
  const snapshots = new Map(conflicts.map((conflict) => [normalizePath(conflict.output.outputPath), conflict]));
  const groupPaths = await resolveKeepBothGroups(outputs, decision, reservedPaths, normalizePath);
  const resolved: ResolvedOutput[] = [];

  for (const output of outputs) {
    let { outputPath } = output;
    const groupPath = output.keepBothGroup ? groupPaths.get(normalizePath(output.keepBothGroup.basePath)) : undefined;

    if (groupPath !== undefined) {
      outputPath = `${groupPath}${output.keepBothGroup?.suffix ?? ''}`;
      reservedPaths.add(normalizePath(outputPath));
    } else if (decision === 'keep-both' && (await pathExists(output.outputPath))) {
      outputPath = await findAvailableOutputPath(output.outputPath, reservedPaths, normalizePath);
      reservedPaths.add(normalizePath(outputPath));
    }

    const snapshot = snapshots.get(normalizePath(output.outputPath));
    const existedBeforeCommit = decision === 'overwrite' && snapshot !== undefined;
    const contentHashBeforeConflict = decision === 'overwrite' ? snapshot?.contentHash : undefined;

    resolved.push({
      ...output,
      outputPath,
      existedBeforeCommit,
      ...(contentHashBeforeConflict === undefined ? {} : { contentHashBeforeConflict }),
    });
  }

  return resolved;
}

async function resolveKeepBothGroups(
  outputs: PreparedConversionOutput[],
  decision: OutputConflictDecision,
  reservedPaths: Set<string>,
  normalizePath: PathNormalizer,
): Promise<Map<string, string>> {
  const groups = new Map<string, PreparedConversionOutput[]>();

  if (decision !== 'keep-both') {
    return new Map();
  }

  for (const output of outputs) {
    if (output.keepBothGroup === undefined) {
      continue;
    }

    const key = normalizePath(output.keepBothGroup.basePath);
    groups.set(key, [...(groups.get(key) ?? []), output]);
  }

  const resolved = new Map<string, string>();
  for (const [key, group] of groups) {
    const existingPaths = await Promise.all(group.map(async (output) => pathExists(output.outputPath)));
    if (!existingPaths.some(Boolean)) {
      continue;
    }

    const basePath = group[0]?.keepBothGroup?.basePath;
    if (basePath === undefined) {
      continue;
    }

    for (let suffix = 1; ; suffix += 1) {
      const candidateBase = appendNumericSuffix(basePath, suffix);
      const candidatePaths = group.map((output) => `${candidateBase}${output.keepBothGroup?.suffix ?? ''}`);
      const candidatePathsExist = await Promise.all(candidatePaths.map(async (candidate) => pathExists(candidate)));
      if (
        candidatePaths.every((candidate) => !reservedPaths.has(normalizePath(candidate))) &&
        candidatePathsExist.every((exists) => !exists)
      ) {
        resolved.set(key, candidateBase);
        break;
      }
    }
  }

  return resolved;
}

function appendNumericSuffix(filePath: string, suffix: number): string {
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);
  return path.join(path.dirname(filePath), `${basename}-${suffix}${extension}`);
}

async function createBackups(
  outputs: ResolvedOutput[],
  decision: OutputConflictDecision,
  copyFileImpl: AbortableCopyFile,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (decision !== 'overwrite') {
    return;
  }

  for (const output of outputs) {
    if (!output.existedBeforeCommit) {
      continue;
    }

    await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
    const previousFilePath = `${output.stagedOutputPath}.previous`;
    await assertWritablePathInWorkspace(previousFilePath, stagingBoundary(output));
    await mkdir(path.dirname(previousFilePath), { recursive: true });
    await copyFileImpl(output.outputPath, previousFilePath, fsConstants.COPYFILE_EXCL, signal);
    output.previousFilePath = previousFilePath;
  }
}

async function commitResolvedOutputs(
  outputs: ResolvedOutput[],
  options: CommitConversionOutputsOptions,
): Promise<CommittedConversionOutput[]> {
  const committed: ResolvedOutput[] = [];
  const rollbackCandidates: ResolvedOutput[] = [];
  const copyFileImpl = options.copyFile ?? copyFileWithAbort;

  try {
    for (const output of outputs) {
      options.signal?.throwIfAborted();
      await assertExistingPathInWorkspace(output.stagedOutputPath, stagingBoundary(output));
      await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);
      await mkdir(path.dirname(output.outputPath), { recursive: true });
      options.signal?.throwIfAborted();

      if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
        await assertExistingPathInWorkspace(output.previousFilePath, stagingBoundary(output));

        if (!(await filesHaveEqualContents(output.outputPath, output.previousFilePath))) {
          throw new Error(`Output changed before overwrite: ${output.outputPath}`);
        }
      } else {
        output.createdOutputIdentity = await createOwnedOutputPlaceholder(output.outputPath);
      }

      rollbackCandidates.push(output);
      await copyPreparedOutput(output, options, copyFileImpl);
      output.copyCompleted = true;
      committed.push(output);
      options.signal?.throwIfAborted();
    }
  } catch (error) {
    const rollbackErrors = await rollbackCommittedOutputs(rollbackCandidates, options);

    if (rollbackErrors.length > 0) {
      for (const failure of rollbackErrors) {
        options.outputChannel?.appendLine(
          `[${options.operationName ?? 'conversion'}] rollback failed for ${failure.outputPath}: ${failure.error.message}`,
        );
        const output = outputs.find((item) => item.outputPath === failure.outputPath);
        if (output?.previousFilePath !== undefined) {
          options.outputChannel?.appendLine(
            `[${options.operationName ?? 'conversion'}] preserving recovery backup for ${failure.outputPath}: ${output.previousFilePath}`,
          );
        }
      }
      const recoveryBackupPaths = rollbackErrors.flatMap((failure) => {
        const output = outputs.find((item) => item.outputPath === failure.outputPath);
        return output?.previousFilePath !== undefined && output.previousFilePath !== ''
          ? [output.previousFilePath]
          : [];
      });
      throw new CommitRollbackError(error, rollbackErrors, recoveryBackupPaths);
    }

    throw error instanceof Error ? error : new Error(String(error));
  }

  return committed.map(({ outputPath, workspacePath, previousFilePath, stagingRootPath, stagingWorkspacePath }) => {
    const result: CommittedConversionOutput = { outputPath, workspacePath };

    if (previousFilePath !== undefined) {
      result.previousFilePath = previousFilePath;
    }

    if (stagingRootPath !== undefined) {
      result.stagingRootPath = stagingRootPath;
    }
    if (stagingWorkspacePath !== undefined) {
      result.stagingWorkspacePath = stagingWorkspacePath;
    }

    options.outputChannel?.appendLine(`[${options.operationName ?? 'conversion'}] committed output: ${outputPath}`);

    return result;
  });
}

function toArtifactRoots(outputs: PreparedConversionOutput[]): ConversionArtifactRoot[] {
  return outputs.flatMap((output) =>
    output.stagingRootPath !== undefined && output.stagingRootPath !== ''
      ? [
          {
            rootPath: output.stagingRootPath,
            workspacePath: stagingBoundary(output),
          },
        ]
      : [],
  );
}

async function rollbackCommittedOutputs(
  outputs: ResolvedOutput[],
  options: CommitConversionOutputsOptions,
): Promise<RollbackFailure[]> {
  const copyFileImpl = options.copyFile ?? copyFileWithAbort;
  const rmImpl = options.rm ?? rm;
  const failures: RollbackFailure[] = [];

  for (let index = outputs.length - 1; index >= 0; index -= 1) {
    const output = outputs[index];

    if (!output) {
      continue;
    }

    try {
      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);

      if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
        await assertExistingPathInWorkspace(output.previousFilePath, stagingBoundary(output));

        if (
          output.copyCompleted === true &&
          !(await filesHaveEqualContents(output.outputPath, output.stagedOutputPath))
        ) {
          throw new Error('Output changed after commit; the recovery backup was preserved.');
        }

        await copyFileImpl(output.previousFilePath, output.outputPath);
      } else if (output.createdOutputIdentity !== undefined) {
        const currentIdentity = await readFileIdentity(output.outputPath);

        if (!sameFileIdentity(currentIdentity, output.createdOutputIdentity)) {
          throw new Error('Output was replaced by another process; it was not removed.');
        }

        if (
          output.copyCompleted === true &&
          !(await filesHaveEqualContents(output.outputPath, output.stagedOutputPath))
        ) {
          throw new Error('New output changed after commit; it was not removed.');
        }

        await rmImpl(output.outputPath, { force: true });
      }
    } catch (error) {
      failures.push({ outputPath: output.outputPath, error: asError(error) });
    }
  }

  return failures;
}

async function copyPreparedOutput(
  output: ResolvedOutput,
  options: CommitConversionOutputsOptions,
  copyFileImpl: AbortableCopyFile,
): Promise<void> {
  if (output.previousFilePath === undefined) {
    await copyFileImpl(output.stagedOutputPath, output.outputPath, undefined, options.signal);
    return;
  }

  const temporaryPath = path.join(
    path.dirname(output.outputPath),
    `.${path.basename(output.outputPath)}.graphics-workbench-${crypto.randomUUID()}.tmp`,
  );
  const renameImpl = options.rename ?? rename;

  try {
    await assertWritablePathInWorkspace(temporaryPath, output.workspacePath);
    await copyFileImpl(output.stagedOutputPath, temporaryPath, undefined, options.signal);
    await assertExistingPathInWorkspace(temporaryPath, output.workspacePath);

    try {
      await renameImpl(temporaryPath, output.outputPath);
    } catch (error) {
      if (!isWindowsRenameConflict(error)) {
        throw asError(error);
      }

      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
      if (!(await filesHaveEqualContents(output.outputPath, output.previousFilePath))) {
        throw new Error(`Output changed before atomic replacement: ${output.outputPath}`, { cause: error });
      }
      await rm(output.outputPath);
      await renameImpl(temporaryPath, output.outputPath);
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function validatePreparedOutputs(outputs: PreparedConversionOutput[]): Promise<void> {
  await Promise.all(
    outputs.flatMap((output) => [
      assertExistingPathInWorkspace(output.stagedOutputPath, stagingBoundary(output)),
      assertWritablePathInWorkspace(output.outputPath, output.workspacePath),
    ]),
  );
}

async function findExistingOutputs(outputs: PreparedConversionOutput[]): Promise<ExistingOutputSnapshot[]> {
  const existence = await Promise.all(outputs.map(async (output) => pathExists(output.outputPath)));
  return Promise.all(
    outputs.flatMap((output, index) => (existence[index] === true ? [createExistingOutputSnapshot(output)] : [])),
  );
}

async function createExistingOutputSnapshot(output: PreparedConversionOutput): Promise<ExistingOutputSnapshot> {
  return { output, contentHash: await hashFile(output.outputPath) };
}

type PathNormalizer = (filePath: string) => string;

async function findAvailableOutputPath(
  requestedPath: string,
  reservedPaths: Set<string>,
  normalizePath: PathNormalizer,
): Promise<string> {
  const extension = path.extname(requestedPath);
  const basename = path.basename(requestedPath, extension);
  const directory = path.dirname(requestedPath);

  for (let suffix = 1; ; suffix++) {
    const candidate = path.join(directory, `${basename}-${suffix}${extension}`);
    const normalizedCandidate = normalizePath(candidate);

    if (!reservedPaths.has(normalizedCandidate) && !(await pathExists(candidate))) {
      return candidate;
    }
  }
}

function assertUniqueRequestedOutputs(outputs: PreparedConversionOutput[], normalizePath: PathNormalizer): void {
  const normalizedPaths = new Set<string>();

  for (const output of outputs) {
    const normalizedPath = normalizePath(output.outputPath);

    if (normalizedPaths.has(normalizedPath)) {
      throw new Error(`Multiple conversions resolve to the same output: ${output.outputPath}`);
    }

    normalizedPaths.add(normalizedPath);
  }
}

async function createPathNormalizer(filePaths: readonly string[]): Promise<PathNormalizer> {
  const caseInsensitiveDirectories = new Set<string>();
  const checkedDirectories = new Set<string>();

  for (const filePath of filePaths) {
    const directory = await findNearestExistingDirectory(path.dirname(path.resolve(filePath)));
    if (checkedDirectories.has(directory)) {
      continue;
    }
    checkedDirectories.add(directory);
    if (process.platform === 'win32' || (await isCaseInsensitiveDirectory(directory))) {
      caseInsensitiveDirectories.add(directory);
    }
  }

  return (filePath: string): string => {
    const resolved = path.resolve(filePath).normalize('NFC');
    const directory = path.dirname(resolved);
    const isCaseInsensitive = [...caseInsensitiveDirectories].some((root) => {
      const relative = path.relative(root, directory);
      return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`));
    });
    return isCaseInsensitive ? resolved.toLocaleLowerCase('en-US') : resolved;
  };
}

async function findNearestExistingDirectory(directory: string): Promise<string> {
  let current = path.resolve(directory);
  for (;;) {
    try {
      const currentStat = await stat(current);
      if (currentStat.isDirectory()) {
        return current;
      }
    } catch {
      // Continue toward the filesystem root.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return current;
    }
    current = parent;
  }
}

async function isCaseInsensitiveDirectory(directory: string): Promise<boolean> {
  const probeName = `.graphics-workbench-case-probe-${crypto.randomUUID()}`;
  const lowerPath = path.join(directory, probeName.toLowerCase());
  const upperPath = path.join(directory, probeName.toUpperCase());

  try {
    await writeFile(lowerPath, '', { flag: 'wx' });
    try {
      await access(upperPath);
      return true;
    } catch {
      return false;
    }
  } finally {
    await rm(lowerPath, { force: true });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function assertConflictOutputsUnchanged(outputs: ResolvedOutput[]): Promise<void> {
  await Promise.all(
    outputs.map(async (output) => {
      if (output.contentHashBeforeConflict === undefined) {
        return;
      }

      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);

      if ((await hashFile(output.outputPath)) !== output.contentHashBeforeConflict) {
        throw new Error(`Output changed before overwrite: ${output.outputPath}`);
      }
    }),
  );
}

async function createOwnedOutputPlaceholder(outputPath: string): Promise<FileIdentity> {
  const handle = await open(outputPath, 'wx');

  try {
    const outputStat = await handle.stat();
    return { dev: outputStat.dev, ino: outputStat.ino };
  } finally {
    await handle.close();
  }
}

async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  const fileStat = await stat(filePath);
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function isWindowsRenameConflict(error: unknown): boolean {
  return (
    process.platform === 'win32' &&
    error instanceof Error &&
    'code' in error &&
    (error.code === 'EEXIST' || error.code === 'EPERM')
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
