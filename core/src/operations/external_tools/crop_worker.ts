import { readFile } from 'node:fs/promises';

import { cropPdfFile } from '../pdf/crop_pdf_core.js';
import { openPdfDocument } from '../pdf/mupdf.js';
import { getPdfPageGeometry } from '../pdf/pdf_page_geometry.js';

import { parseCropWorkerRequest, type CropPdfMetadata, type CropWorkerResult } from './run_crop_worker.js';

let requestReceived = false;

process.on('disconnect', () => {
  process.exitCode = 1;
  process.exit();
});

// oxlint-disable-next-line typescript/no-restricted-types -- child processから届くIPCメッセージの検証境界。
process.on('message', (message: unknown) => {
  if (requestReceived) {
    sendResult({ ok: false, error: 'Crop worker received more than one request.' });
    return;
  }

  requestReceived = true;
  void runRequest(message);
});

// oxlint-disable-next-line typescript/no-restricted-types -- child processから届くIPCメッセージの検証境界。
async function runRequest(message: unknown): Promise<void> {
  try {
    const request = parseCropWorkerRequest(message);
    let value: CropPdfMetadata | undefined;
    if (request.type === 'inspect') {
      value = await inspectMetadata(request.filePath);
    } else {
      await cropPdfFile(request.request);
    }

    sendResult({ ok: true, value });
  } catch (error) {
    sendResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function inspectMetadata(filePath: string): Promise<CropPdfMetadata> {
  const document = await openPdfDocument(await readFile(filePath));
  try {
    const pageCount = document.countPages();
    const pages = Array.from({ length: pageCount }, (_value, index) =>
      getPdfPageGeometry(document.loadPage(index), index + 1),
    );
    if (pages.length === 0) {
      throw new Error('PDF has no pages.');
    }

    return { pageCount, pages };
  } finally {
    document.destroy();
  }
}

function sendResult(result: CropWorkerResult): void {
  if (process.send === undefined) {
    process.exitCode = 1;
    process.exit();
    return;
  }

  try {
    process.send(result, (error) => {
      if (error !== null) {
        process.exitCode = 1;
        process.exit();
        return;
      }

      process.exit(0);
    });
  } catch {
    process.exitCode = 1;
    process.exit();
  }
}
