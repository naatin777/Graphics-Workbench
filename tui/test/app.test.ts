import { describe, expect, test } from 'bun:test';

import type { TerminalKey, TerminalScreen } from '../src/screen.js';
import { conflictDecision, runTerminalUi } from '../src/app.js';
import type { TerminalUiConversionResult, TerminalUiPdfSource } from '../src/conversion_adapter.js';

const source: TerminalUiPdfSource = {
  sourcePath: '/tmp/paper.pdf',
  workspacePath: '/tmp',
  workspaceName: 'tmp',
  pageCount: 1,
};

const successfulResult: TerminalUiConversionResult = {
  outputs: [{ outputPath: '/tmp/paper/1.png' }],
  cleanup: { attempted: 1, succeeded: 1, failures: [] },
};

describe('Terminal UI controller', () => {
  test('success、failure、cancellationのどの終了経路でもscreenを1回だけdestroyする', async () => {
    for (const outcome of ['success', 'failure', 'cancel'] as const) {
      const screen = new FakeScreen();
      let observedAbort = false;
      const session = runTerminalUi('/tmp/paper.pdf', screen, {
        inspectSource: async () => source,
        runConversion: async ({ runtime }) => {
          if (outcome === 'failure') {
            throw new Error('injected conversion failure');
          }
          if (outcome === 'cancel') {
            await new Promise<void>((resolve) => {
              runtime.signal?.addEventListener(
                'abort',
                () => {
                  observedAbort = true;
                  resolve();
                },
                { once: true },
              );
            });
            runtime.signal?.throwIfAborted();
          }
          return successfulResult;
        },
      });

      await screen.waitFor('Convert to');
      screen.enter();
      screen.enter();
      screen.enter();
      if (outcome === 'cancel') {
        await screen.waitFor('Converting PDF');
        screen.key({ name: 'escape', sequence: '\u001B', ctrl: false });
        await screen.waitFor('Conversion cancelled');
        expect(observedAbort).toBe(true);
      } else if (outcome === 'failure') {
        await screen.waitFor('Conversion failed');
      } else {
        await screen.waitFor('Conversion complete');
      }
      screen.enter();
      await session;
      expect(screen.destroyCount).toBe(1);
    }
  });

  test('Ctrl+Cは変換と同じAbortSignalをabortしてoperationがsettleするまでscreenを保持する', async () => {
    const screen = new FakeScreen();
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const session = runTerminalUi('/tmp/paper.pdf', screen, {
      inspectSource: async () => source,
      runConversion: async ({ runtime }) => {
        signal = runtime.signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        runtime.signal?.throwIfAborted();
        return successfulResult;
      },
    });

    await screen.waitFor('Convert to');
    screen.enter();
    screen.enter();
    screen.enter();
    await screen.waitFor('Converting PDF');
    screen.key({ name: 'c', sequence: '\u0003', ctrl: true });
    expect(signal?.aborted).toBe(true);
    expect(screen.destroyCount).toBe(0);
    release();
    await screen.waitFor('Conversion cancelled');
    screen.enter();
    await session;
    expect(screen.destroyCount).toBe(1);
  });

  test('loading中のEscはinspectのAbortSignalをabortし、settle後にscreenをdestroyする', async () => {
    const screen = new FakeScreen();
    let observedAbort = false;
    const session = runTerminalUi('/tmp/paper.pdf', screen, {
      inspectSource: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        signal?.throwIfAborted();
        return source;
      },
    });

    await screen.waitFor('Analyzing PDF');
    screen.key({ name: 'escape', sequence: '\u001B', ctrl: false });
    await session;
    expect(observedAbort).toBe(true);
    expect(screen.destroyCount).toBe(1);
  });

  test('output conflictでRenameを選ぶとoperation resolverへkeep-bothを返す', async () => {
    const screen = new FakeScreen();
    let decision: string | undefined;
    const session = runTerminalUi('/tmp/paper.pdf', screen, {
      inspectSource: async () => source,
      runConversion: async ({ runtime }) => {
        decision = await runtime.resolveConflicts?.(['/tmp/paper/1.png']);
        return successfulResult;
      },
    });

    await screen.waitFor('Convert to');
    screen.enter();
    screen.enter();
    screen.enter();
    await screen.waitFor('Output already exists');
    screen.key({ name: 'down', sequence: '', ctrl: false });
    screen.key({ name: 'down', sequence: '', ctrl: false });
    screen.enter();
    await screen.waitFor('Conversion complete');
    expect(decision).toBe('keep-both');
    screen.enter();
    await session;
    expect(screen.destroyCount).toBe(1);
  });

  test('renderer側からdestroyされた場合もsessionを終了し、cleanupを再入させない', async () => {
    const screen = new FakeScreen();
    const session = runTerminalUi('/tmp/paper.pdf', screen, {
      inspectSource: async () => source,
      runConversion: async ({ runtime }) => {
        await new Promise<void>((resolve) => {
          runtime.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        runtime.signal?.throwIfAborted();
        return successfulResult;
      },
    });
    await screen.waitFor('Convert to');
    screen.enter();
    screen.enter();
    screen.enter();
    await screen.waitFor('Converting PDF');
    screen.closeExternally();
    await session;
    expect(screen.destroyCount).toBe(1);
    expect(screen.renderAfterCloseCount).toBe(0);
  });

  test('output conflictのCancel/Replace/Renameを既存operation decisionへ対応させる', () => {
    expect(conflictDecision('cancel')).toBe('cancel');
    expect(conflictDecision('replace')).toBe('overwrite');
    expect(conflictDecision('rename')).toBe('keep-both');
  });
});

class FakeScreen implements TerminalScreen {
  content = '';
  destroyCount = 0;
  renderAfterCloseCount = 0;
  #closed = false;
  #keyHandler: ((key: TerminalKey) => void) | undefined;
  #destroyHandler: (() => void) | undefined;

  setContent(content: string): void {
    if (this.#closed) {
      this.renderAfterCloseCount += 1;
      return;
    }
    this.content = content;
  }

  onKey(handler: (key: TerminalKey) => void): () => void {
    this.#keyHandler = handler;
    return () => {
      this.#keyHandler = undefined;
    };
  }

  onDestroy(handler: () => void): () => void {
    this.#destroyHandler = handler;
    return () => {
      this.#destroyHandler = undefined;
    };
  }

  destroy(): void {
    this.destroyCount += 1;
  }

  key(key: TerminalKey): void {
    this.#keyHandler?.(key);
  }

  closeExternally(): void {
    this.#closed = true;
    this.#destroyHandler?.();
  }

  enter(): void {
    this.key({ name: 'return', sequence: '\r', ctrl: false });
  }

  async waitFor(text: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (this.content.includes(text)) {
        return;
      }
      await Bun.sleep(1);
    }
    throw new Error(`Screen did not include ${JSON.stringify(text)}. Last content:\n${this.content}`);
  }
}
