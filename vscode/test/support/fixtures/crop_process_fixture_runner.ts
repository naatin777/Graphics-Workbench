import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { CROP_PDF_PROCESS_PROTOCOL_VERSION } from '../../../src/operations/pdf/crop_pdf_process_protocol.js';

process.on('message', (message: unknown) => {
  const requestId = readRequestId(message);
  send(
    {
      type: 'started',
      protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
      requestId,
    },
    false,
    () => runBehavior(requestId),
  );
});

function runBehavior(requestId: string): void {
  const behavior = process.env.CROP_PROCESS_FIXTURE_BEHAVIOR ?? 'unknown';
  switch (behavior) {
    case 'exit-23': {
      process.disconnect();
      process.exitCode = 23;
      return;
    }
    case 'success-then-exit-1': {
      send(
        {
          type: 'success',
          protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
          requestId,
        },
        true,
        () => {
          process.exitCode = 1;
        },
      );
      return;
    }
    case 'hang-with-descendant': {
      startHangingDescendant();
      setInterval(() => undefined, 1000);
      return;
    }
    default: {
      send(
        {
          type: 'failure',
          protocolVersion: CROP_PDF_PROCESS_PROTOCOL_VERSION,
          requestId,
          error: 'Unknown crop process fixture behavior.',
        },
        true,
      );
    }
  }
}

function send(message: Record<string, unknown>, disconnectAfterSend: boolean, afterSend?: () => void): void {
  if (process.send === undefined) {
    afterSend?.();
    return;
  }

  process.send(message, () => {
    if (disconnectAfterSend) {
      process.disconnect();
    }
    afterSend?.();
  });
}

function startHangingDescendant(): void {
  const descendant = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
    detached: false,
    stdio: 'ignore',
  });
  descendant.unref();
  const pidFile = process.env.CROP_PROCESS_FIXTURE_PID_FILE;
  if (pidFile !== undefined) {
    writeFileSync(pidFile, String(descendant.pid));
  }
}

function readRequestId(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'requestId' in value) {
    const { requestId } = value;
    if (typeof requestId === 'string' && requestId !== '') {
      return requestId;
    }
  }

  return 'fixture-request';
}
