import {
  BoxRenderable,
  CliRenderEvents,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
  type KeyEvent,
} from '@opentui/core';

export interface TerminalKey {
  name: string;
  sequence: string;
  ctrl: boolean;
}

export interface TerminalScreen {
  setContent(content: string): void;
  onKey(handler: (key: TerminalKey) => void): () => void;
  onDestroy(handler: () => void): () => void;
  destroy(): void;
}

export async function createOpenTuiScreen(): Promise<TerminalScreen> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    clearOnShutdown: true,
    useMouse: false,
  });
  return new OpenTuiScreen(renderer);
}

class OpenTuiScreen implements TerminalScreen {
  readonly #renderer: CliRenderer;
  readonly #content: TextRenderable;
  #destroyed = false;

  constructor(renderer: CliRenderer) {
    this.#renderer = renderer;
    const frame = new BoxRenderable(renderer, {
      id: 'graphics-workbench-frame',
      width: '100%',
      height: '100%',
      border: true,
      borderStyle: 'rounded',
      borderColor: '#6ea8fe',
      title: ' Graphics Workbench ',
      padding: 1,
    });
    this.#content = new TextRenderable(renderer, {
      id: 'graphics-workbench-content',
      width: '100%',
      height: '100%',
      content: '',
    });
    frame.add(this.#content);
    renderer.root.add(frame);
  }

  setContent(content: string): void {
    if (this.#destroyed) {
      return;
    }
    this.#content.content = content;
    this.#renderer.requestRender();
  }

  onKey(handler: (key: TerminalKey) => void): () => void {
    const listener = (key: KeyEvent): void => {
      handler({ name: key.name, sequence: key.sequence, ctrl: key.ctrl });
    };
    this.#renderer.keyInput.on('keypress', listener);
    return () => {
      this.#renderer.keyInput.off('keypress', listener);
    };
  }

  onDestroy(handler: () => void): () => void {
    const listener = (): void => {
      this.#destroyed = true;
      handler();
    };
    this.#renderer.on(CliRenderEvents.DESTROY, listener);
    return () => {
      this.#renderer.off(CliRenderEvents.DESTROY, listener);
    };
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.#renderer.destroy();
  }
}
