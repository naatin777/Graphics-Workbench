export class OperationCancelledError extends Error {
  constructor(message = 'Operation was cancelled.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof OperationCancelledError || (error instanceof Error && error.name === 'AbortError');
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return stderr ? `${error.message}\n${stderr}` : error.message;
  }

  return String(error);
}
