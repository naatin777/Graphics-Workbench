import { cropPdfFile } from './crop_pdf_core.js';
import {
  CROP_PDF_PROCESS_PROTOCOL_VERSION,
  parseCropPdfProcessRequest,
  type CropPdfProcessFailure,
  type CropPdfProcessMessage,
  type CropPdfProcessStarted,
  type CropPdfProcessSuccess,
} from './crop_pdf_process_protocol.js';

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
    sendResult(
      {
        type: 'failure',
        protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
        requestId: readRequestId(message),
        error: 'Crop Configure runner received more than one request.',
      },
      true,
    );
    return;
  }

  requestReceived = true;
  void runRequest(message);
});

async function runRequest(message: unknown): Promise<void> {
  let requestId = readRequestId(message);

  try {
    const request = parseCropPdfProcessRequest(message);
    ({ requestId } = request);
    sendResult(
      {
        type: 'started',
        protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
        requestId,
      } satisfies CropPdfProcessStarted,
      false,
    );
    await cropPdfFile(request);
    sendResult(
      {
        type: 'success',
        protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
        requestId,
      } satisfies CropPdfProcessSuccess,
      true,
    );
  } catch (error) {
    sendResult(
      {
        type: 'failure',
        protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      } satisfies CropPdfProcessFailure,
      true,
    );
  }
}

function sendResult(message: CropPdfProcessMessage, disconnectAfterSend: boolean): void {
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

function readRequestId(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'requestId' in value) {
    const { requestId } = value;
    if (typeof requestId === 'string' && requestId !== '') {
      return requestId;
    }
  }

  return 'unknown';
}
