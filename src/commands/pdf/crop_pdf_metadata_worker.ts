import { readFile } from 'node:fs/promises';
import { parentPort } from 'node:worker_threads';

import { PDFDocument } from 'pdf-lib';

interface CropPdfMetadataRequest {
  filePath: string;
}

if (parentPort === null) {
  throw new Error('Crop Configure metadata worker requires parentPort.');
}

parentPort.on('message', (message: unknown) => {
  void inspectMetadata(message);
});

async function inspectMetadata(message: unknown): Promise<void> {
  try {
    const request = parseRequest(message);
    const bytes = await readFile(request.filePath);

    const document = await PDFDocument.load(bytes);
    const pageCount = document.getPageCount();

    const mediaBox = document.getPages()[0]?.getMediaBox();
    /* oxlint-disable unicorn/require-post-message-target-origin -- Worker MessagePort has no targetOrigin. */
    parentPort?.postMessage({
      ok: true,
      pageCount,
      width: mediaBox?.width ?? 0,
      height: mediaBox?.height ?? 0,
    });
    /* oxlint-enable unicorn/require-post-message-target-origin */
  } catch (error) {
    /* oxlint-disable unicorn/require-post-message-target-origin -- Worker MessagePort has no targetOrigin. */
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    /* oxlint-enable unicorn/require-post-message-target-origin */
  }
}

function parseRequest(value: unknown): CropPdfMetadataRequest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid Crop Configure metadata worker request.');
  }

  const candidate = value as Partial<CropPdfMetadataRequest>;
  if (typeof candidate.filePath !== 'string') {
    throw new Error('Invalid Crop Configure metadata worker request.');
  }

  return { filePath: candidate.filePath };
}
