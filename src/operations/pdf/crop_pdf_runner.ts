import { cropPdfFile, type CropPdfFileRequest } from './crop_pdf_core.js';

interface CropRunnerSuccess {
  ok: true;
}

interface CropRunnerFailure {
  ok: false;
  error: string;
}

process.on('message', (message: unknown) => {
  void runRequest(message);
});

async function runRequest(message: unknown): Promise<void> {
  try {
    await cropPdfFile(parseRequest(message));
    sendResult({ ok: true } satisfies CropRunnerSuccess);
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    sendResult({ ok: false, error: failureMessage } satisfies CropRunnerFailure);
  }
}

function sendResult(message: CropRunnerSuccess | CropRunnerFailure): void {
  if (process.send === undefined) {
    return;
  }
  process.send(message, () => {
    process.disconnect();
  });
}

function parseRequest(value: unknown): CropPdfFileRequest {
  if (!isRecord(value)) {
    throw new Error('Invalid Crop Configure runner request.');
  }

  const cropBox = value.cropBox;
  if (!isCropBox(cropBox)) {
    throw new Error('Invalid Crop Configure runner crop box.');
  }

  const target = value.target;
  if (!isCropTarget(target)) {
    throw new Error('Invalid Crop Configure runner target.');
  }

  if (typeof value.sourcePath !== 'string' || typeof value.stagedOutputPath !== 'string') {
    throw new Error('Invalid Crop Configure runner paths.');
  }

  return { sourcePath: value.sourcePath, stagedOutputPath: value.stagedOutputPath, cropBox, target };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCropBox(value: unknown): value is CropPdfFileRequest['cropBox'] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.left === 'number' &&
    typeof value.bottom === 'number' &&
    typeof value.right === 'number' &&
    typeof value.top === 'number'
  );
}

function isCropTarget(value: unknown): value is CropPdfFileRequest['target'] {
  if (!isRecord(value) || (value.type !== 'all' && value.type !== 'selected')) {
    return false;
  }

  return value.type === 'all' || (Array.isArray(value.pages) && value.pages.every((page) => typeof page === 'number'));
}
