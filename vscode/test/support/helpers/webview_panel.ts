import type { SinonSandbox, SinonStub } from 'sinon';
import * as vscode from 'vscode';

export interface WebviewPanelMock {
  panel: vscode.WebviewPanel;
  postMessage: SinonStub;
  dispose: SinonStub;
  /** Runs the captured onDidReceiveMessage listeners with the given message. */
  receiveMessage: (message: unknown) => void;
  /** Runs the captured onDidDispose listeners. */
  closePanel: () => void;
}

/** Stubs createWebviewPanel and returns a getter for the last created panel mock. */
export function stubWebviewPanel(sandbox: SinonSandbox): () => WebviewPanelMock {
  let createdPanel: WebviewPanelMock | undefined;
  const webviewListeners = new Set<(message: unknown) => void>();
  const disposeListeners = new Set<() => void>();

  sandbox.stub(vscode.window, 'createWebviewPanel').callsFake(() => {
    const postMessage = sandbox.stub().resolves(true);
    const dispose = sandbox.stub().callsFake(() => {
      for (const listener of disposeListeners) {
        listener();
      }
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal WebviewPanel stub; the command under test only uses webview/onDidDispose/dispose.
    const panel = {
      webview: {
        html: '',
        cspSource: 'vscode-webview://test',
        postMessage,
        onDidReceiveMessage: (listener: (message: unknown) => void) => {
          webviewListeners.add(listener);
          return { dispose: (): void => undefined };
        },
        asWebviewUri: (uri: vscode.Uri) => uri,
      },
      onDidDispose: (listener: () => void) => {
        disposeListeners.add(listener);
        return { dispose: (): void => undefined };
      },
      dispose,
    } as unknown as vscode.WebviewPanel;

    createdPanel = {
      panel,
      postMessage,
      dispose,
      receiveMessage: (message) => {
        for (const listener of webviewListeners) {
          listener(message);
        }
      },
      closePanel: () => {
        for (const listener of disposeListeners) {
          listener();
        }
      },
    };
    return panel;
  });

  return () => {
    if (createdPanel === undefined) {
      throw new Error('createWebviewPanel was never called.');
    }
    return createdPanel;
  };
}

export async function waitFor(check: () => boolean, timeoutMilliseconds = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
