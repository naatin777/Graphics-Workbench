import { hasExactKeys, isNonEmptyString, isRecord } from '../../shared/protocols/protocol_utils.js';
import type { CropPdfFileRequest } from './crop_pdf_core.js';

export const CROP_PDF_PROCESS_PROTOCOL_VERSION = 1;

export type CropPdfProcessRequest = CropPdfFileRequest & {
  type: 'crop-pdf';
  protocolVersion: typeof CROP_PDF_PROCESS_PROTOCOL_VERSION;
  requestId: string;
};

export type CropPdfProcessMessage = CropPdfProcessStarted | CropPdfProcessSuccess | CropPdfProcessFailure;

export interface CropPdfProcessStarted {
  type: 'started';
  protocolVersion: typeof CROP_PDF_PROCESS_PROTOCOL_VERSION;
  requestId: string;
}

export interface CropPdfProcessSuccess {
  type: 'success';
  protocolVersion: typeof CROP_PDF_PROCESS_PROTOCOL_VERSION;
  requestId: string;
}

export interface CropPdfProcessFailure {
  type: 'failure';
  protocolVersion: typeof CROP_PDF_PROCESS_PROTOCOL_VERSION;
  requestId: string;
  error: string;
}

export function createCropPdfProcessRequest(request: CropPdfFileRequest, requestId: string): CropPdfProcessRequest {
  return {
    type: 'crop-pdf',
    protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
    requestId,
    ...request,
  };
}

export function isCropPdfProcessMessage(value: unknown): value is CropPdfProcessMessage {
  if (
    !isRecord(value) ||
    value.protocolVersion !== CROP_PDF_PROCESS_PROTOCOL_VERSION ||
    !isNonEmptyString(value.requestId)
  ) {
    return false;
  }

  if (value.type === 'started' || value.type === 'success') {
    return hasExactKeys(value, ['type', 'protocolVersion', 'requestId']);
  }

  return (
    value.type === 'failure' &&
    hasExactKeys(value, ['type', 'protocolVersion', 'requestId', 'error']) &&
    isNonEmptyString(value.error)
  );
}

export function parseCropPdfProcessRequest(value: unknown): CropPdfProcessRequest {
  if (!isRecord(value) || value.type !== 'crop-pdf') {
    throw new Error('Invalid Crop Configure runner request.');
  }
  if (value.protocolVersion !== CROP_PDF_PROCESS_PROTOCOL_VERSION) {
    throw new Error('Unsupported Crop Configure runner protocol.');
  }
  if (!isNonEmptyString(value.requestId)) {
    throw new Error('Invalid Crop Configure runner request ID.');
  }
  if (
    !hasExactKeys(value, [
      'type',
      'protocolVersion',
      'requestId',
      'sourcePath',
      'stagedOutputPath',
      'cropBox',
      'target',
    ])
  ) {
    throw new Error('Invalid Crop Configure runner request.');
  }

  const { cropBox } = value;
  if (!isCropBox(cropBox)) {
    throw new Error('Invalid Crop Configure runner crop box.');
  }

  const { target } = value;
  if (!isCropTarget(target)) {
    throw new Error('Invalid Crop Configure runner target.');
  }

  if (!isNonEmptyString(value.sourcePath) || !isNonEmptyString(value.stagedOutputPath)) {
    throw new Error('Invalid Crop Configure runner paths.');
  }

  return {
    type: 'crop-pdf',
    protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
    requestId: value.requestId,
    sourcePath: value.sourcePath,
    stagedOutputPath: value.stagedOutputPath,
    cropBox,
    target,
  };
}

function isCropBox(value: unknown): value is CropPdfProcessRequest['cropBox'] {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['left', 'bottom', 'right', 'top']) &&
    typeof value.left === 'number' &&
    Number.isFinite(value.left) &&
    typeof value.bottom === 'number' &&
    Number.isFinite(value.bottom) &&
    typeof value.right === 'number' &&
    Number.isFinite(value.right) &&
    typeof value.top === 'number' &&
    Number.isFinite(value.top)
  );
}

function isCropTarget(value: unknown): value is CropPdfProcessRequest['target'] {
  if (!isRecord(value) || (value.type !== 'all' && value.type !== 'selected')) {
    return false;
  }

  return (
    (value.type === 'all' && hasExactKeys(value, ['type'])) ||
    (hasExactKeys(value, ['type', 'pages']) &&
      Array.isArray(value.pages) &&
      value.pages.every((page) => Number.isInteger(page) && page > 0))
  );
}
