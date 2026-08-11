import type * as vscode from 'vscode';

export async function withCancellationSignal<T>(
  token: vscode.CancellationToken,
  callback: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const abortController = new AbortController();
  const cancellationSubscription = token.onCancellationRequested(() => {
    abortController.abort();
  });
  const abortFromParent = (): void => {
    abortController.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    if (token.isCancellationRequested) {
      abortController.abort();
    }
    if (parentSignal?.aborted === true) {
      abortFromParent();
    }

    return await callback(abortController.signal);
  } finally {
    cancellationSubscription.dispose();
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
