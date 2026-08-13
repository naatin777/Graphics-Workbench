import { fork } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as v from 'valibot';

import { OperationCancelledError } from '@graphics-workbench/core/runtime';
import { terminateProcessTree, type LineOutputChannel } from '@graphics-workbench/core/external-tools';
import type { CropPdfFileRequest, PdfPageGeometry } from '@graphics-workbench/core/pdf';

export interface CropPdfMetadata {
  pageCount: number;
  pages: PdfPageGeometry[];
}

export type CropWorkerRequest = { type: 'inspect'; filePath: string } | { type: 'crop'; request: CropPdfFileRequest };

export type CropWorkerResult = { ok: true; value: CropPdfMetadata | undefined } | { ok: false; error: string };

const CropBoxSchema = v.strictObject({
  left: v.pipe(v.number(), v.finite()),
  bottom: v.pipe(v.number(), v.finite()),
  right: v.pipe(v.number(), v.finite()),
  top: v.pipe(v.number(), v.finite()),
});

const CropTargetSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('all'),
  }),
  v.strictObject({
    type: v.literal('selected'),
    pages: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(1))), v.minLength(1)),
  }),
]);

const CropPdfFileRequestSchema = v.strictObject({
  sourcePath: v.pipe(v.string(), v.nonEmpty()),
  stagedOutputPath: v.pipe(v.string(), v.nonEmpty()),
  cropBox: CropBoxSchema,
  target: CropTargetSchema,
});

const CropWorkerRequestSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('inspect'),
    filePath: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.strictObject({
    type: v.literal('crop'),
    request: CropPdfFileRequestSchema,
  }),
]);

const PdfRectangleSchema = v.strictObject({
  x: v.pipe(v.number(), v.finite()),
  y: v.pipe(v.number(), v.finite()),
  width: v.pipe(v.number(), v.finite()),
  height: v.pipe(v.number(), v.finite()),
});

const PdfPageGeometrySchema = v.strictObject({
  page: v.pipe(v.number(), v.integer(), v.minValue(1)),
  mediaBox: PdfRectangleSchema,
  cropBox: PdfRectangleSchema,
  rotation: v.picklist([0, 90, 180, 270]),
});

const CropPdfMetadataSchema = v.strictObject({
  pageCount: v.pipe(v.number(), v.integer(), v.minValue(1)),
  pages: v.pipe(v.array(PdfPageGeometrySchema), v.minLength(1)),
});

const CropWorkerResultSchema = v.variant('ok', [
  v.strictObject({
    ok: v.literal(true),
    value: v.optional(CropPdfMetadataSchema),
  }),
  v.strictObject({
    ok: v.literal(false),
    error: v.pipe(v.string(), v.nonEmpty()),
  }),
]);

// child processから届く未検証IPCメッセージを具体型へパースする境界。
// oxlint-disable-next-line typescript/no-restricted-types -- child processから届く未検証IPCメッセージをvalibotで具体型へ変換する境界。
export function parseCropWorkerRequest(value: unknown): CropWorkerRequest {
  const result = v.safeParse(CropWorkerRequestSchema, value);
  if (!result.success) {
    throw new Error('Invalid Crop worker request.');
  }
  return result.output;
}

// child processから届く未検証IPCメッセージを具体型へパースする境界。
// oxlint-disable-next-line typescript/no-restricted-types -- child processから届く未検証IPCメッセージをvalibotで具体型へ変換する境界。
export function parseCropWorkerResult(value: unknown): CropWorkerResult {
  const result = v.safeParse(CropWorkerResultSchema, value);
  if (!result.success) {
    throw new Error('Invalid Crop worker result.');
  }
  const parsed = result.output;
  if (parsed.ok) {
    return { ok: true, value: parsed.value };
  }
  return parsed;
}

export interface CropWorkerChild extends EventEmitter {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  send(message: CropWorkerRequest, callback?: (error: Error | null) => void): boolean;
}

export interface RunCropWorkerOptions {
  outputChannel?: LineOutputChannel;
  workerPath?: string;
  launcher?: (workerPath: string) => CropWorkerChild;
}

/** Runs a single crop or metadata inspection in an isolated worker process so cancellation can kill the whole process tree. */
export async function runCropWorker(
  request: CropWorkerRequest,
  signal?: AbortSignal,
  options: RunCropWorkerOptions = {},
): Promise<CropPdfMetadata | undefined> {
  const { outputChannel } = options;
  const log = (event: string, details = ''): void => {
    const suffix = details === '' ? '' : ` ${details}`;
    outputChannel?.appendLine(`[crop-process] ${event}${suffix}`);
  };

  if (signal?.aborted === true) {
    log('operation-cancelled-before-start');
    throw new OperationCancelledError('Crop processing was cancelled.');
  }

  const workerPath = options.workerPath ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'crop_worker.js');
  const launcher = options.launcher ?? defaultLauncher;

  log('operation-started');

  return new Promise<CropPdfMetadata | undefined>((resolve, reject) => {
    let child: CropWorkerChild;
    try {
      child = launcher(workerPath);
    } catch (error) {
      const normalized = asError(error);
      log('child-spawn-failed', `error=${formatLogValue(normalized.message)}`);
      reject(normalized);
      return;
    }

    let settled = false;

    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };

    const finish = (error: Error | undefined, value?: CropPdfMetadata): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error !== undefined) {
        log(
          isCancellationError(error) ? 'operation-cancelled' : 'operation-failed',
          `error=${formatLogValue(error.message)}`,
        );
        reject(error);
        return;
      }
      log('process-completed');
      resolve(value);
    };

    const abort = (): void => {
      if (settled) {
        return;
      }
      terminateProcessTree(child);
      finish(new OperationCancelledError('Crop processing was cancelled.'));
    };

    // oxlint-disable-next-line typescript/no-restricted-types -- 子プロセスIPC境界の未検証メッセージ。
    const onMessage = (message: unknown): void => {
      if (settled) {
        return;
      }
      let result: CropWorkerResult;
      try {
        result = parseCropWorkerResult(message);
      } catch {
        finish(new Error('Crop worker protocol error: invalid result message.'));
        return;
      }
      log('result-received');
      if (result.ok) {
        finish(undefined, result.value);
      } else {
        finish(new Error(result.error));
      }
    };

    const onError = (error: Error): void => {
      finish(error);
    };

    const onExit = (code: number | null): void => {
      finish(new Error(`Crop worker exited without a result (code ${code}).`));
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
    signal?.addEventListener('abort', abort, { once: true });

    log('child-spawned');
    if (signal?.aborted === true) {
      abort();
      return;
    }

    log('request-sent');
    try {
      child.send(request);
    } catch (error) {
      finish(asError(error));
    }
  });
}

function defaultLauncher(workerPath: string): CropWorkerChild {
  return fork(workerPath, [], {
    detached: process.platform !== 'win32',
    execArgv: withoutInlineScriptArgs(process.execArgv),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCancellationError(error: Error): boolean {
  return error instanceof OperationCancelledError || error.name === 'AbortError';
}

function formatLogValue(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').slice(0, 500);
}

function withoutInlineScriptArgs(execArgv: readonly string[]): string[] {
  return execArgv.filter((argument, index) => {
    const previous = execArgv[index - 1];
    return (
      argument !== '--input-type=module' &&
      argument !== '-e' &&
      argument !== '--eval' &&
      previous !== '-e' &&
      previous !== '--eval'
    );
  });
}
