import { OperationCancelledError } from '../operations/lifecycle/operation_cancelled_error.js';

export function isAbortError(error: unknown): boolean {
  return error instanceof OperationCancelledError || (error instanceof Error && error.name === 'AbortError');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
