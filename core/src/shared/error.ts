export class OperationCancelledError extends Error {
  constructor(message = 'Operation was cancelled.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
export function isAbortError(error: unknown): boolean {
  return error instanceof OperationCancelledError || (error instanceof Error && error.name === 'AbortError');
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    return stderr ? `${error.message}\n${stderr}` : error.message;
  }

  return String(error);
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
export function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

// oxlint-disable-next-line typescript/no-restricted-types -- catchが投げる値は任意の型を取り得る。
export function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
