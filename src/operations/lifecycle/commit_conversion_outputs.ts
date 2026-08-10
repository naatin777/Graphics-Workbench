import { constants as fsConstants, createReadStream } from 'node:fs';
import { access, chmod, mkdir, open, rename, rm, stat, utimes, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  assertExistingPathInWorkspace,
  assertPathIsNotSymbolicLink,
  assertWritablePathInWorkspace,
} from '../../security/workspace_path.js';

import {
  cleanupConversionArtifacts,
  type CleanupPreservingError,
  type ConversionArtifactRoot,
} from './cleanup_conversion_artifacts.js';
import { OperationCancelledError } from '../../shared/error.js';
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
  stagingWorkspacePath?: string;
  keepBothGroup?: {
    basePath: string;
    suffix: string;
  };
}

export interface CommittedConversionOutput {
  outputPath: string;
  workspacePath: string;
  /** SHA-256 of the staged input result that was committed. */
  sha256: string;
  previousFilePath?: string;
  previousFileMetadata?: PreviousFileMetadata;
  stagingRootPath?: string;
  stagingWorkspacePath?: string;
}

export interface PreviousFileMetadata {
  mode: number;
  atimeMs: number;
  mtimeMs: number;
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
  previousFileMetadata?: PreviousFileMetadata;
  existedBeforeCommit: boolean;
  contentHashBeforeConflict?: string;
  createdOutputIdentity?: FileIdentity;
  ownedOutputHandle?: FileHandle;
  copyCompleted: boolean;
  outputMutation: 'untouched' | 'removed' | 'replaced';
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

export { OperationCancelledError } from '../../shared/error.js';

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
    options.outputChannel?.appendLine(`[${options.operationName ?? 'input'}] conflict decision: ${decision}`);
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
      copyCompleted: false,
      outputMutation: 'untouched',
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
    await assertPathIsNotSymbolicLink(output.outputPath);
    const previousFilePath = `${output.stagedOutputPath}.previous`;
    await assertWritablePathInWorkspace(previousFilePath, stagingBoundary(output));
    await mkdir(path.dirname(previousFilePath), { recursive: true });
    const previousFileMetadata = await readFileMetadata(output.outputPath);
    try {
      await copyFileImpl(output.outputPath, previousFilePath, fsConstants.COPYFILE_EXCL, signal);
      const expectedHash = output.contentHashBeforeConflict;
      if (expectedHash === undefined) {
        throw new Error(`No conflict snapshot for existing output: ${output.outputPath}`);
      }
      const [currentHash, backupHash] = await Promise.all([hashFile(output.outputPath), hashFile(previousFilePath)]);
      if (currentHash !== expectedHash || backupHash !== expectedHash) {
        throw new Error(`Output changed while creating overwrite backup: ${output.outputPath}`);
      }
    } catch (error) {
      await rm(previousFilePath, { force: true }).catch(() => {
        // Preserve the backup/copy error; later cleanup can retry when a root is tracked.
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
    output.previousFilePath = previousFilePath;
    output.previousFileMetadata = previousFileMetadata;
  }
}

async function commitResolvedOutputs(
  outputs: ResolvedOutput[],
  options: CommitConversionOutputsOptions,
): Promise<CommittedConversionOutput[]> {
  const committed: { output: ResolvedOutput; sha256: string }[] = [];
  const rollbackCandidates: ResolvedOutput[] = [];
  const copyFileImpl = options.copyFile ?? copyFileWithAbort;

  try {
    for (const output of outputs) {
      const committedSha256 = await commitResolvedOutput(output, options, copyFileImpl, rollbackCandidates);
      committed.push({ output, sha256: committedSha256 });
      options.signal?.throwIfAborted();
    }
  } catch (error) {
    await closeOwnedOutputHandles(outputs);
    const rollbackErrors = await rollbackCommittedOutputs(rollbackCandidates, options);

    if (rollbackErrors.length > 0) {
      for (const failure of rollbackErrors) {
        options.outputChannel?.appendLine(
          `[${options.operationName ?? 'input'}] rollback failed for ${failure.outputPath}: ${failure.error.message}`,
        );
        const output = outputs.find((item) => item.outputPath === failure.outputPath);
        if (output?.previousFilePath !== undefined) {
          options.outputChannel?.appendLine(
            `[${options.operationName ?? 'input'}] preserving recovery backup for ${failure.outputPath}: ${output.previousFilePath}`,
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
  } finally {
    await closeOwnedOutputHandles(outputs);
  }

  return committed.map((item) => toCommittedOutput(item, options));
}

async function commitResolvedOutput(
  output: ResolvedOutput,
  options: CommitConversionOutputsOptions,
  copyFileImpl: AbortableCopyFile,
  rollbackCandidates: ResolvedOutput[],
): Promise<string> {
  // Known limitation: Node.js has no portable openat/conditional-rename API, so the final
  // validation and open/rename cannot be one atomic operation. The repeated boundary and inode
  // checks below narrow that TOCTOU window; see the file-operation security contract.
  options.signal?.throwIfAborted();
  await assertExistingPathInWorkspace(output.stagedOutputPath, stagingBoundary(output));
  await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);
  await mkdir(path.dirname(output.outputPath), { recursive: true });
  options.signal?.throwIfAborted();
  const committedSha256 = await hashFile(output.stagedOutputPath);
  options.signal?.throwIfAborted();
  // Hashing a large staged result gives another process time to replace an
  // already-validated parent directory with a symlink. Re-resolve the output
  // boundary immediately before opening or replacing the user-visible path.
  await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);

  if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
    await assertPathIsNotSymbolicLink(output.outputPath);
    await assertExistingPathInWorkspace(output.previousFilePath, stagingBoundary(output));

    if (!(await filesHaveEqualContents(output.outputPath, output.previousFilePath))) {
      throw new Error(`Output changed before overwrite: ${output.outputPath}`);
    }
  } else {
    const ownedOutput = await createOwnedOutputHandle(output.outputPath, output.workspacePath);
    output.createdOutputIdentity = ownedOutput.identity;
    output.ownedOutputHandle = ownedOutput.handle;
  }

  if (output.previousFilePath === undefined) {
    rollbackCandidates.push(output);
  }
  await copyPreparedOutput(output, options, copyFileImpl, () => {
    rollbackCandidates.push(output);
  });
  output.copyCompleted = true;
  return committedSha256;
}

function toCommittedOutput(
  { output, sha256 }: { output: ResolvedOutput; sha256: string },
  options: CommitConversionOutputsOptions,
): CommittedConversionOutput {
  const { outputPath, workspacePath, previousFilePath, previousFileMetadata, stagingRootPath, stagingWorkspacePath } =
    output;
  const result: CommittedConversionOutput = { outputPath, workspacePath, sha256 };

  if (previousFilePath !== undefined) {
    result.previousFilePath = previousFilePath;
  }
  if (previousFileMetadata !== undefined) {
    result.previousFileMetadata = previousFileMetadata;
  }
  if (stagingRootPath !== undefined) {
    result.stagingRootPath = stagingRootPath;
  }
  if (stagingWorkspacePath !== undefined) {
    result.stagingWorkspacePath = stagingWorkspacePath;
  }

  options.outputChannel?.appendLine(`[${options.operationName ?? 'input'}] committed output: ${outputPath}`);
  return result;
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
      if (output.previousFilePath !== undefined && output.previousFilePath !== '') {
        await rollbackOverwrittenOutput(output, copyFileImpl);
      } else if (output.createdOutputIdentity !== undefined) {
        await rollbackNewOutput(output, rmImpl);
      }
    } catch (error) {
      failures.push({ outputPath: output.outputPath, error: asError(error) });
    }
  }

  return failures;
}

async function rollbackOverwrittenOutput(output: ResolvedOutput, copyFileImpl: AbortableCopyFile): Promise<void> {
  const { previousFilePath } = output;
  if (previousFilePath === undefined || previousFilePath === '') {
    throw new Error(`No recovery backup for overwritten output: ${output.outputPath}`);
  }
  await assertExistingPathInWorkspace(previousFilePath, stagingBoundary(output));

  if (output.outputMutation === 'removed') {
    await assertWritablePathInWorkspace(output.outputPath, output.workspacePath);
    await copyFileImpl(previousFilePath, output.outputPath, fsConstants.COPYFILE_EXCL);
    await restoreFileMetadata(output.outputPath, output.previousFileMetadata);
    return;
  }

  await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
  await assertPathIsNotSymbolicLink(output.outputPath);
  if (output.outputMutation === 'replaced') {
    if (!(await filesHaveEqualContents(output.outputPath, output.stagedOutputPath))) {
      throw new Error('Output changed after commit; the recovery backup was preserved.');
    }

    await copyFileImpl(previousFilePath, output.outputPath);
    await restoreFileMetadata(output.outputPath, output.previousFileMetadata);
    return;
  }

  if (!(await filesHaveEqualContents(output.outputPath, previousFilePath))) {
    throw new Error('Output changed before commit; the recovery backup was preserved.');
  }
}

async function rollbackNewOutput(output: ResolvedOutput, rmImpl: typeof rm): Promise<void> {
  await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
  const currentIdentity = await readFileIdentity(output.outputPath);

  if (output.createdOutputIdentity === undefined || !sameFileIdentity(currentIdentity, output.createdOutputIdentity)) {
    throw new Error('Output was replaced by another process; it was not removed.');
  }
  if (output.copyCompleted && !(await filesHaveEqualContents(output.outputPath, output.stagedOutputPath))) {
    throw new Error('New output changed after commit; it was not removed.');
  }

  await rmImpl(output.outputPath, { force: true });
}

async function copyPreparedOutput(
  output: ResolvedOutput,
  options: CommitConversionOutputsOptions,
  copyFileImpl: AbortableCopyFile,
  beforeExistingOutputMutation: () => void,
): Promise<void> {
  if (output.previousFilePath === undefined) {
    const handle = output.ownedOutputHandle;

    if (handle === undefined) {
      throw new Error(`No owned output handle for new output: ${output.outputPath}`);
    }

    await pipeline(createReadStream(output.stagedOutputPath, { signal: options.signal }), handle.createWriteStream(), {
      signal: options.signal,
    });
    await assertOwnedOutputStillAtPath(output);
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
    options.signal?.throwIfAborted();

    await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
    if (!(await filesHaveEqualContents(output.outputPath, output.previousFilePath))) {
      throw new Error(`Output changed before atomic replacement: ${output.outputPath}`);
    }
    options.signal?.throwIfAborted();
    beforeExistingOutputMutation();

    try {
      await renameImpl(temporaryPath, output.outputPath);
      output.outputMutation = 'replaced';
    } catch (error) {
      if (!isWindowsRenameConflict(error)) {
        throw asError(error);
      }

      await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
      if (!(await filesHaveEqualContents(output.outputPath, output.previousFilePath))) {
        throw new Error(`Output changed before atomic replacement: ${output.outputPath}`, { cause: error });
      }
      await rm(output.outputPath);
      output.outputMutation = 'removed';
      options.signal?.throwIfAborted();
      await renameImpl(temporaryPath, output.outputPath);
      output.outputMutation = 'replaced';
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
      throw new Error(`Multiple inputs resolve to the same output: ${output.outputPath}`);
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

async function createOwnedOutputHandle(
  outputPath: string,
  workspacePath: string,
): Promise<{ handle: FileHandle; identity: FileIdentity }> {
  const handle = await open(outputPath, 'wx');

  try {
    const outputStat = await handle.stat();
    const identity = { dev: outputStat.dev, ino: outputStat.ino };
    await assertExistingPathInWorkspace(outputPath, workspacePath);
    await assertPathIsNotSymbolicLink(outputPath);
    const pathIdentity = await readFileIdentity(outputPath);
    if (!sameFileIdentity(identity, pathIdentity)) {
      throw new Error(`New output path was replaced while being opened: ${outputPath}`);
    }
    return { handle, identity };
  } catch (error) {
    await handle.close();
    throw asError(error);
  }
}

async function assertOwnedOutputStillAtPath(output: ResolvedOutput): Promise<void> {
  await assertExistingPathInWorkspace(output.outputPath, output.workspacePath);
  await assertPathIsNotSymbolicLink(output.outputPath);
  const pathIdentity = await readFileIdentity(output.outputPath);
  if (output.createdOutputIdentity === undefined || !sameFileIdentity(pathIdentity, output.createdOutputIdentity)) {
    throw new Error(`New output path was replaced during commit: ${output.outputPath}`);
  }
}

async function closeOwnedOutputHandles(outputs: ResolvedOutput[]): Promise<void> {
  await Promise.all(
    outputs.map(async (output) => {
      const handle = output.ownedOutputHandle;

      if (handle === undefined) {
        return;
      }

      delete output.ownedOutputHandle;

      try {
        await handle.close();
      } catch {
        // Best-effort close so rollback can still remove the output.
      }
    }),
  );
}

async function readFileIdentity(filePath: string): Promise<FileIdentity> {
  const fileStat = await stat(filePath);
  return { dev: fileStat.dev, ino: fileStat.ino };
}

function sameFileIdentity(first: FileIdentity, second: FileIdentity): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

async function readFileMetadata(filePath: string): Promise<PreviousFileMetadata> {
  const fileStat = await stat(filePath);
  return {
    mode: fileStat.mode & 0o7777,
    atimeMs: Math.trunc(fileStat.atimeMs),
    mtimeMs: Math.trunc(fileStat.mtimeMs),
  };
}

export async function restoreFileMetadata(filePath: string, metadata: PreviousFileMetadata | undefined): Promise<void> {
  if (metadata === undefined) {
    return;
  }

  await chmod(filePath, metadata.mode);
  await utimes(filePath, new Date(metadata.atimeMs), new Date(metadata.mtimeMs));
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
