import { readFile } from 'node:fs/promises';
import { openPdfDocument } from '../../operations/pdf/mupdf.js';

import { getPdfPageGeometry } from '../../operations/pdf/pdf_page_geometry.js';
import type { PdfPageGeometry } from '../../application/protocols/crop_pdf_protocol.js';

let requestReceived = false;
let disconnectRequested = false;

process.on('disconnect', () => {
  if (!disconnectRequested) {
    process.exitCode = 1;
    process.exit();
  }
});

process.on('message', (message: unknown) => {
  if (requestReceived) {
    sendResult({ type: 'failure', error: 'Crop Configure metadata runner received more than one request.' }, true);
    return;
  }

  requestReceived = true;
  void inspectMetadata(message);
});

async function inspectMetadata(message: unknown): Promise<void> {
  try {
    const filePath = parseFilePath(message);
    const document = await openPdfDocument(await readFile(filePath));
    try {
      const pageCount = document.countPages();
      const pages = Array.from({ length: pageCount }, (_value, index) =>
        getPdfPageGeometry(document.loadPage(index), index + 1),
      );
      if (pages.length === 0) {
        throw new Error('PDF has no pages.');
      }

      sendResult({ type: 'success', pages }, true);
    } finally {
      document.destroy();
    }
  } catch (error) {
    sendResult({ type: 'failure', error: error instanceof Error ? error.message : String(error) }, true);
  }
}

function sendResult(message: CropPdfMetadataProcessMessage, disconnectAfterSend: boolean): void {
  if (process.send === undefined) {
    return;
  }

  try {
    process.send(message, (error) => {
      if (error !== null) {
        process.exitCode = 1;
        process.exit();
        return;
      }

      if (disconnectAfterSend && process.connected) {
        disconnectRequested = true;
        process.disconnect();
        process.exit(0);
      }
    });
  } catch {
    process.exitCode = 1;
    process.exit();
  }
}

function parseFilePath(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('filePath' in value)) {
    throw new Error('Invalid Crop Configure metadata runner request.');
  }

  const filePath = Reflect.get(value, 'filePath');
  if (typeof filePath !== 'string' || filePath === '') {
    throw new Error('Invalid Crop Configure metadata runner request.');
  }

  return filePath;
}

type CropPdfMetadataProcessMessage = { type: 'success'; pages: PdfPageGeometry[] } | { type: 'failure'; error: string };
