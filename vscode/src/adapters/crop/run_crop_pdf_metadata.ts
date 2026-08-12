import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { OperationCancelledError } from '@graphics-workbench/core/runtime';
import type { PdfPageGeometry } from '@graphics-workbench/core/pdf';
import { terminateProcessTree } from '@graphics-workbench/core/external-tools';

export interface CropPdfMetadata {
  pageCount: number;
  pages: PdfPageGeometry[];
}

/** Reads PDF page geometry in a disposable child process so large metadata loads do not pressure the Extension Host. */
export async function inspectCropPdfMetadata(filePath: string, signal: AbortSignal): Promise<CropPdfMetadata> {
  return new Promise<CropPdfMetadata>((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('../../commands/pdf/crop_pdf_metadata_runner.js', import.meta.url)), [], {
      detached: process.platform !== 'win32',
      execArgv: withoutInlineScriptArgs(process.execArgv),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let settled = false;
    let exited = false;

    const cleanup = (): void => {
      signal.removeEventListener('abort', abort);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (!exited) {
        terminateProcessTree(child);
      }
    };
    const finish = (error?: Error, metadata?: CropPdfMetadata): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error !== undefined) {
        reject(error);
      } else if (metadata === undefined) {
        reject(new Error('Crop Configure metadata process returned no result.'));
      } else {
        resolve(metadata);
      }
    };
    const abort = (): void => {
      finish(new OperationCancelledError('Crop Configure metadata inspection was cancelled.'));
    };
    const onMessage = (message: CropPdfMetadataProcessMessage): void => {
      if (message.type === 'success' && message.pages.length > 0) {
        finish(undefined, { pageCount: message.pages.length, pages: message.pages });
        return;
      }

      finish(new Error(message.type === 'failure' ? message.error : 'Crop Configure metadata inspection failed.'));
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    const onExit = (code: number | null): void => {
      exited = true;
      if (!settled) {
        finish(new Error(`Crop Configure metadata process exited without a result (code ${code}).`));
      }
    };

    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    try {
      child.send({ filePath }, (error) => {
        if (error !== null) {
          finish(error);
        }
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

type CropPdfMetadataProcessMessage = { type: 'success'; pages: PdfPageGeometry[] } | { type: 'failure'; error: string };

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
