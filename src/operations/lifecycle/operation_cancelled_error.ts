export class OperationCancelledError extends Error {
  constructor(message = 'Operation was cancelled.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}
