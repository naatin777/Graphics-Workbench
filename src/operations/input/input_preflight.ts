import { stat } from 'node:fs/promises';
import path from 'node:path';

import pLimit from 'p-limit';

import { sourceFormatForPath, type SourceFormat } from '../../application/policy/source_format.js';
import { assertExistingPathInWorkspace } from '../../security/workspace_path.js';
import { rawByteLength, readRawSidecar } from '../conversion/raster_input.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import type { LineOutputChannel } from '../external_tools/external_tool_ascii_scratch.js';

export interface PreflightReport {
  sourcePath: string;
  format: SourceFormat | undefined;
  fileSize: number;
  result: 'ok' | 'error';
  reason?: string;
}

export interface BatchPreflightResult {
  reports: PreflightReport[];
  errors: PreflightReport[];
  canProceed: boolean;
}

export interface AssertPreflightPassedOptions {
  outputChannel?: LineOutputChannel;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface PreflightBatchOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

const PREFLIGHT_CONCURRENCY = 2;

export async function runPreflightBatch(
  sourcePaths: string[],
  options: PreflightBatchOptions = {},
): Promise<BatchPreflightResult> {
  const total = sourcePaths.length;
  let completed = 0;
  options.signal?.throwIfAborted();

  const reports: PreflightReport[] = [];
  reports.length = sourcePaths.length;

  const limit = pLimit(PREFLIGHT_CONCURRENCY);

  await Promise.all(
    sourcePaths.map((sourcePath, index) =>
      limit(async () => {
        options.signal?.throwIfAborted();

        try {
          const report = await runPreflight(sourcePath);
          options.signal?.throwIfAborted();
          reports[index] = report;
          completed += 1;
          options.onProgress?.(completed, total);
        } catch (error) {
          if (options.signal?.aborted === true) {
            options.signal.throwIfAborted();
          }

          throw error instanceof Error ? error : new Error(String(error));
        }
      }),
    ),
  );

  options.signal?.throwIfAborted();
  const errors = reports.filter((report) => report.result === 'error');
  return { reports, errors, canProceed: errors.length === 0 };
}

function formatPreflightReport(report: PreflightReport): string {
  let line = `[preflight] ${report.sourcePath}: ${report.result}`;
  if (report.reason !== undefined && report.reason !== '') {
    line += ` — ${report.reason}`;
  }
  return line;
}

/**
 * Runs preflight on all source files and throws if any error is found.
 */
export function preflightOptionsFromRuntime(runtime?: ConversionExecutionContext): AssertPreflightPassedOptions {
  const options: AssertPreflightPassedOptions = {};
  if (runtime?.outputChannel !== undefined) {
    options.outputChannel = runtime.outputChannel;
  }
  if (runtime?.signal !== undefined) {
    options.signal = runtime.signal;
  }
  return options;
}

export async function assertPreflightPassed(
  jobs: { sourcePath: string; workspacePath?: string }[],
  options?: AssertPreflightPassedOptions,
): Promise<void> {
  await Promise.all(
    jobs.flatMap((job) =>
      sourceFormatForPath(job.sourcePath) === 'raw' && job.workspacePath !== undefined
        ? [assertExistingPathInWorkspace(`${job.sourcePath}.json`, job.workspacePath)]
        : [],
    ),
  );
  const sourcePaths = jobs.map((job) => job.sourcePath);
  const batchOptions: PreflightBatchOptions = {};
  if (options?.signal !== undefined) {
    batchOptions.signal = options.signal;
  }
  if (options?.onProgress !== undefined) {
    batchOptions.onProgress = options.onProgress;
  }
  const result = await runPreflightBatch(sourcePaths, batchOptions);

  for (const report of result.reports) {
    options?.outputChannel?.appendLine(formatPreflightReport(report));
  }

  if (!result.canProceed) {
    const reasons = result.errors.map((error) => `${error.sourcePath}: ${error.reason ?? 'unknown error'}`).join('\n');
    throw new Error(`Preflight validation failed:\n${reasons}`);
  }
}

async function runPreflight(sourcePath: string): Promise<PreflightReport> {
  const format = sourceFormatForPath(sourcePath);

  if (format === undefined) {
    return {
      sourcePath,
      format,
      fileSize: 0,
      result: 'error',
      reason: `Unsupported format: ${path.extname(sourcePath)}`,
    };
  }

  const fileStat = await safeStat(sourcePath);

  if (fileStat.error !== undefined) {
    return {
      sourcePath,
      format,
      fileSize: 0,
      result: 'error',
      reason: 'File not readable',
    };
  }

  if (!fileStat.isFile) {
    return {
      sourcePath,
      format,
      fileSize: fileStat.size,
      result: 'error',
      reason: 'Input is not a regular file',
    };
  }

  const fileSize = fileStat.size;

  if (fileSize === 0) {
    return { sourcePath, format, fileSize, result: 'error', reason: 'Empty file' };
  }

  if (format === 'raw') {
    return validateRawSidecar(sourcePath, format, fileSize);
  }

  return { sourcePath, format, fileSize, result: 'ok' };
}

function validateRawSidecar(sourcePath: string, format: SourceFormat, fileSize: number): PreflightReport {
  try {
    const rawSidecar = readRawSidecar(sourcePath);
    const expectedBytes = rawByteLength(rawSidecar);
    if (fileSize !== expectedBytes) {
      return {
        sourcePath,
        format,
        fileSize,
        result: 'error',
        reason: `Raw byte length mismatch: expected ${expectedBytes} bytes, got ${fileSize}`,
      };
    }
    return { sourcePath, format, fileSize, result: 'ok' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { sourcePath, format, fileSize, result: 'error', reason: message };
  }
}

async function safeStat(filePath: string): Promise<{ size: number; isFile: boolean; error?: string }> {
  try {
    const fileStat = await stat(filePath);
    return { size: fileStat.size, isFile: fileStat.isFile() };
  } catch (error) {
    return { size: 0, isFile: false, error: error instanceof Error ? error.message : String(error) };
  }
}
