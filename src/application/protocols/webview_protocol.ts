import { hasExactKeys, isNonEmptyString, isRecord, isString } from './protocol_utils.js';

export type WebviewMessage<Type extends string = string, Payload = never> = [Payload] extends [never]
  ? { type: Type }
  : { type: Type; payload: Payload };

export type WebviewErrorMessage = WebviewMessage<'error', { message: string }>;

type WebviewEnvelope = { type: string; payload?: unknown };

export function isWebviewEnvelope(value: unknown): value is WebviewEnvelope {
  return isRecord(value) && isNonEmptyString(value.type) && hasExactKeys(value, ['type'], ['payload']);
}

export function isWebviewMessageWithoutPayload<Type extends string>(
  value: unknown,
  type: Type,
): value is WebviewMessage<Type> {
  return isWebviewEnvelope(value) && value.type === type && hasExactKeys(value, ['type']);
}

export function isWebviewMessageWithPayload<Type extends string, Payload>(
  value: unknown,
  type: Type,
  isPayload: (payload: unknown) => payload is Payload,
): value is WebviewMessage<Type, Payload> {
  return (
    isWebviewEnvelope(value) &&
    value.type === type &&
    hasExactKeys(value, ['type', 'payload']) &&
    isPayload(value.payload)
  );
}

export function isWebviewErrorMessage(value: unknown): value is WebviewErrorMessage {
  return isWebviewMessageWithPayload(value, 'error', isWebviewErrorPayload);
}

function isWebviewErrorPayload(value: unknown): value is WebviewErrorMessage['payload'] {
  return isRecord(value) && hasExactKeys(value, ['message']) && isString(value.message);
}
