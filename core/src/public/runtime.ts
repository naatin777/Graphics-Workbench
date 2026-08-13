export { filesHaveEqualContents, hashFile } from '../operations/input/file_content_hash.js';
export {
  cleanupConversionArtifacts,
  stagingArtifactsForInputs,
  withStagingCleanup,
  type CleanupPreservingError,
  type CleanupResult,
  type ConversionArtifactRoot,
} from '../operations/lifecycle/cleanup_conversion_artifacts.js';
export {
  CommitRollbackError,
  commitStagedOutputs,
  OperationCancelledError,
  restoreFileMetadata,
  type CommitConversionOutputsOptions,
  type CommittedConversionOutput,
  type OutputConflictDecision,
  type PreparedConversionOutput,
  type PreviousFileMetadata,
  type RollbackFailure,
} from '../operations/lifecycle/commit_conversion_outputs.js';
export type {
  ConversionExecutionContext,
  ResolvedConversionRuntime,
} from '../operations/lifecycle/conversion_runtime.js';
export { copyFileWithAbort, type AbortableCopyFile } from '../operations/lifecycle/copy_file_with_abort.js';
export {
  asRunId,
  assertSafePathSegment,
  createRunId,
  isSafePathSegment,
  stagingRootPathFor,
  type RunId,
} from '../operations/lifecycle/run_id.js';
export {
  runStagedConversionBatch,
  type StagedConversionBatch,
} from '../operations/lifecycle/run_staged_conversion_batch.js';
export {
  cleanupStaleSecurePdfStagingRoots,
  createSecurePdfStagingRoot,
  startSecurePdfStagingHeartbeat,
} from '../operations/lifecycle/secure_staging.js';
export { isAbortError, toErrorMessage } from '../shared/error.js';
