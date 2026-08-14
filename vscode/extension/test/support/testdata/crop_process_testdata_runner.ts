import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

process.on('message', () => {
  runBehavior();
});

function runBehavior(): void {
  const behavior = process.env.CROP_PROCESS_FIXTURE_BEHAVIOR ?? 'unknown';
  switch (behavior) {
    case 'exit-23': {
      process.disconnect();
      process.exitCode = 23;
      return;
    }
    case 'hang-with-descendant': {
      startHangingDescendant();
      setInterval(() => undefined, 1000);
      return;
    }
    default: {
      send({ ok: false, error: 'Unknown crop process テストデータ behavior.' });
    }
  }
}

function send(message: Record<string, unknown>): void {
  if (process.send === undefined) {
    return;
  }

  process.send(message, () => {
    process.disconnect();
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
