// oxlint-disable eslint/max-classes-per-file -- ConversionErrorの各TaggedErrorは同一の変換失敗領域を表し、1ファイルに集約する。
// oxlint-disable unicorn/throw-new-error -- better-resultのTaggedErrorファクトリはnew不要でクラスを返す。
import { Result, TaggedError } from 'better-result';

import { isAbortError, toErrorMessage } from '../../shared/error.js';
import type { CommittedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';

/**
 * Frontend-supplied configuration for a conversion. The high-level conversion
 * API builds concrete backends (Draw.io CLI, Chrome, rsvg-convert, MuPDF,
 * Sharp) from these values so callers never assemble them by hand.
 */
export interface ConversionConfiguration {
  maxInputPixels: number;
  maxAnimationPixels: number;
  platform: NodeJS.Platform;
  svgToPdf: {
    engine: 'chrome' | 'rsvg-convert';
    rsvgConvertPath: string;
    chromePath: string;
  };
  drawioPath: string;
  avifEffort: number;
  webpEffort: number;
  scratchBaseCandidates?: readonly string[];
}

/** A workspace source file the conversion operates on. */
export interface ConversionSource {
  sourcePath: string;
  workspacePath: string;
  workspaceName: string;
  /** When set, only these 1-based pages are converted (split sources). */
  pages?: readonly number[];
}

/** The conversion was cancelled by the user. */
export class CancelledError extends TaggedError('CancelledError')<{
  message: string;
}> {}

/** The request did not describe a valid conversion. */
export class InvalidInputError extends TaggedError('InvalidInputError')<{
  message: string;
}> {}

/** The source format cannot be converted to the requested target. */
export class UnsupportedFormatError extends TaggedError('UnsupportedFormatError')<{
  message: string;
}> {}

/** An external tool (Draw.io, Chrome, rsvg-convert, crop worker) failed. */
export class ExternalToolError extends TaggedError('ExternalToolError')<{
  message: string;
  cause: Error | undefined;
}> {}

/** A filesystem operation failed while staging or committing output. */
export class FileSystemError extends TaggedError('FileSystemError')<{
  message: string;
  code: string | undefined;
  cause: Error | undefined;
}> {}

/** The output path is already in use and the conflict decision cancelled the run. */
export class OutputConflictError extends TaggedError('OutputConflictError')<{
  message: string;
}> {}

export type ConversionError =
  | CancelledError
  | InvalidInputError
  | UnsupportedFormatError
  | ExternalToolError
  | FileSystemError
  | OutputConflictError;

/** Result of a high-level conversion operation. */
export type ConversionResult = Result<CommittedConversionOutput[], ConversionError>;

/**
 * Runs a throwing conversion implementation and maps user-operation failures
 * (cancellation, invalid input, external tool failures, filesystem failures,
 * output conflicts) to tagged errors. Only unexpected programmer errors are
 * rethrown.
 */
export async function toConversionResult(
  run: () => Promise<CommittedConversionOutput[]>,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  try {
    const outputs = await run();
    return Result.ok(outputs);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if (isAbortError(error) || signal?.aborted === true) {
      return Result.err(new CancelledError({ message: toErrorMessage(error) }));
    }
    if (TaggedError.is(error)) {
      return Result.err(new ExternalToolError({ message: toErrorMessage(error), cause: error }));
    }
    return Result.err(classifyFileSystemError(error));
  }
}

function classifyFileSystemError(cause: Error): ConversionError {
  const message = toErrorMessage(cause);
  if (message.includes('Output file already exists')) {
    return new OutputConflictError({ message });
  }
  const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
  return new FileSystemError({ message, code, cause });
}

/** Maps a tagged conversion error to a user-facing message. */
export function conversionErrorMessage(error: ConversionError): string {
  return error.message;
}

/** True when the error represents a user cancellation. */
export function isConversionCancelled(error: ConversionError): boolean {
  return error instanceof CancelledError;
}
