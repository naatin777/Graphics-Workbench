import { render } from 'solid-js/web';

import { isReorderPdfHostToWebviewMessage, type ReorderPdfLabels } from '@graphics-workbench-reorder-pdf-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderBehavior = vi.hoisted(() => ({
  fail: false,
  disposeCount: 0,
}));
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async (_pdfSrc: unknown, container: unknown) => {
    if (renderBehavior.fail) {
      throw new Error('render exploded');
    }
    if (container instanceof Element) {
      container.replaceChildren();
      for (let page = 1; page <= 4; page += 1) {
        const figure = document.createElement('figure');
        figure.className = 'pdf-page';
        figure.dataset.pdfPage = String(page);
        const canvas = document.createElement('canvas');
        figure.append(canvas);
        container.append(figure);
      }
    }
    return {
      firstPageReady: Promise.resolve(),
      dispose: async () => {
        renderBehavior.disposeCount += 1;
      },
    };
  }),
);

vi.mock('./vscode', () => ({
  vscode: { sendMessage },
}));
vi.mock('@webview-shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));

const labels: ReorderPdfLabels = {
  header: {
    title: 'Reorder PDF',
    description: 'Move pages to change the output order.',
  },
  preview: {
    title: 'PDF Preview',
    description: 'Pages in the output order.',
    ariaLabel: 'PDF page preview',
    renderError: 'Could not display the PDF',
    applyError: 'Failed to apply the reorder.',
  },
  order: {
    title: 'Order',
    moveUp: 'Move page up',
    moveDown: 'Move page down',
    positionLabel: 'pages',
  },
  validation: {
    orderRequired: 'The page order cannot be empty.',
    orderInvalid: 'The page order is invalid.',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
  },
};

const initMessage = {
  type: 'init',
  payload: {
    sourceId: 'source-1',
    fileName: 'source.pdf',
    pageCount: 4,
    pdfSrc: 'vscode-resource://source.pdf',
    resources: {},
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  },
} as const;

let disposeApp: (() => void) | undefined;

async function mountAndInit(): Promise<void> {
  disposeApp = render(() => <App />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickButton(text: string): void {
  const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined();
  button?.click();
}

function pageFigures(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.pdf-page')];
}

function orderFromDom(): number[] {
  return pageFigures().map((figure) => Number(figure.dataset.pdfPage));
}

function controlsFor(pageIndex: number): {
  controls: Element;
  up: Element | null;
  down: Element | null;
  position: Element | null;
} {
  const figure = pageFigures()[pageIndex];
  if (!figure) {
    throw new Error(`Missing page at index ${pageIndex}`);
  }
  return {
    controls: figure.querySelector('.reorder-page__controls') ?? figure,
    up: figure.querySelector('.reorder-page__move-up'),
    down: figure.querySelector('.reorder-page__move-down'),
    position: figure.querySelector('.reorder-page__position'),
  };
}

beforeEach(async () => {
  sendMessage.mockClear();
  renderPdfPages.mockClear();
  renderBehavior.fail = false;
  renderBehavior.disposeCount = 0;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  disposeApp?.();
  disposeApp = undefined;
  await flushPromises();
});

test('Applyで初期ページ順を送信する', async () => {
  expect(isReorderPdfHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 2, 3, 4] },
  });
});

test('各pageへcontrolが1組だけ追加され、positionラベルが付く', async () => {
  await mountAndInit();

  const figures = pageFigures();
  expect(figures).toHaveLength(4);
  for (const [index, figure] of figures.entries()) {
    const { controls, position } = controlsFor(index);
    expect(figure.querySelectorAll('.reorder-page__controls')).toHaveLength(1);
    expect(controls).toBe(figure.querySelector('.reorder-page__controls'));
    expect(figure.querySelectorAll('.reorder-page__move-up')).toHaveLength(1);
    expect(figure.querySelectorAll('.reorder-page__move-down')).toHaveLength(1);
    expect(position?.textContent).toBe(String(index + 1));
  }
});

test('ページを上へ移動してApplyで新しい順序を送信する', async () => {
  await mountAndInit();

  const { up } = controlsFor(2);
  up?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  expect(orderFromDom()).toEqual([1, 3, 2, 4]);

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 3, 2, 4] },
  });
});

test('ページを下へ移動してApplyで新しい順序を送信する', async () => {
  await mountAndInit();

  const { down } = controlsFor(1);
  down?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  expect(orderFromDom()).toEqual([1, 3, 2, 4]);

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 3, 2, 4] },
  });
});

test('先頭pageを上へ、末尾pageを下へ移動しても順序が壊れない', async () => {
  await mountAndInit();

  const { up } = controlsFor(0);
  up?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const { down } = controlsFor(3);
  down?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  expect(orderFromDom()).toEqual([1, 2, 3, 4]);
  expect(document.querySelectorAll('.reorder-page__controls')).toHaveLength(4);

  clickButton('Apply');
  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 2, 3, 4] },
  });
});

test('init再受信時に古いcontrolと順序が残らない', async () => {
  await mountAndInit();

  const { up } = controlsFor(2);
  up?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  expect(orderFromDom()).toEqual([1, 3, 2, 4]);

  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();

  const figures = pageFigures();
  expect(figures).toHaveLength(4);
  expect(orderFromDom()).toEqual([1, 2, 3, 4]);
  for (const [index, figure] of figures.entries()) {
    expect(figure.querySelectorAll('.reorder-page__controls')).toHaveLength(1);
    expect(figure.querySelector('.reorder-page__position')?.textContent).toBe(String(index + 1));
  }
});

test('preview failure時にエラー表示とmessageを送信する', async () => {
  renderBehavior.fail = true;
  await mountAndInit();

  expect(sendMessage).toHaveBeenCalledWith({
    type: 'previewLoadFailed',
    payload: { message: 'render exploded' },
  });
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not display the PDF');
});

test('preview再描画で古いcontrollerをdisposeする', async () => {
  await mountAndInit();
  expect(renderBehavior.disposeCount).toBe(0);

  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
  expect(renderBehavior.disposeCount).toBe(1);
});
