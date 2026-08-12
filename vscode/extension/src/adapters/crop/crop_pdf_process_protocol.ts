import * as v from 'valibot';

import type { CropPdfFileRequest } from '@graphics-workbench/core/pdf';

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

const CropPdfProcessRequestSchema = v.strictObject({
  type: v.literal('crop-pdf'),
  protocolVersion: v.literal(CROP_PDF_PROCESS_PROTOCOL_VERSION),
  requestId: v.pipe(v.string(), v.nonEmpty()),
  sourcePath: v.pipe(v.string(), v.nonEmpty()),
  stagedOutputPath: v.pipe(v.string(), v.nonEmpty()),
  cropBox: CropBoxSchema,
  target: CropTargetSchema,
});

const CropPdfProcessMessageSchema = v.variant('type', [
  v.strictObject({
    type: v.literal('started'),
    protocolVersion: v.literal(CROP_PDF_PROCESS_PROTOCOL_VERSION),
    requestId: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.strictObject({
    type: v.literal('success'),
    protocolVersion: v.literal(CROP_PDF_PROCESS_PROTOCOL_VERSION),
    requestId: v.pipe(v.string(), v.nonEmpty()),
  }),
  v.strictObject({
    type: v.literal('failure'),
    protocolVersion: v.literal(CROP_PDF_PROCESS_PROTOCOL_VERSION),
    requestId: v.pipe(v.string(), v.nonEmpty()),
    error: v.pipe(v.string(), v.nonEmpty()),
  }),
]);

export function createCropPdfProcessRequest(request: CropPdfFileRequest, requestId: string): CropPdfProcessRequest {
  return {
    type: 'crop-pdf',
    protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
    requestId,
    ...request,
  };
}

// child processから届くIPCメッセージを検証する型ガード。
// oxlint-disable-next-line typescript/no-restricted-types -- child processからの未検証JSONをvalibotで検証する境界。
export function isCropPdfProcessMessage(value: unknown): value is CropPdfProcessMessage {
  return v.is(CropPdfProcessMessageSchema, value);
}

// child processから届く未検証IPCメッセージを具体型へパースする境界。
// oxlint-disable-next-line typescript/no-restricted-types -- child processからの未検証JSONをvalibotで具体型へ変換する境界。
export function parseCropPdfProcessRequest(value: unknown): CropPdfProcessRequest {
  const result = v.safeParse(CropPdfProcessRequestSchema, value);
  if (!result.success) {
    throw new Error('Invalid Crop Configure runner request.');
  }
  return result.output;
}
