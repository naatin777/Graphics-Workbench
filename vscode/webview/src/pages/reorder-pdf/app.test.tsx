import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import { reorderPdfProtocol, type ReorderPdfLabels } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderBehavior = vi.hoisted(() => ({
  pages: 4,
}));
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async (_pdfSrc: unknown, container: unknown) => {
    if (container instanceof Element) {
      container.replaceChildren();
      for (let page = 1; page <= renderBehavior.pages; page += 1) {
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
      dispose: async () => undefined,
    };
  }),
);

vi.mock('@webview-shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));

const labels: ReorderPdfLabels = {
  header: {
    title: 'Reorder PDF',
    description: 'Move pages to change the output order.',
  },
  preview: {
    title: 'PDF Preview',
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
    resources: {
      workerSrc: 'vscode-resource://pdf.worker.mjs',
      cMapUrl: 'vscode-resource://cmaps/',
      standardFontDataUrl: 'vscode-resource://standard_fonts/',
      wasmUrl: 'vscode-resource://wasm/',
    },
    preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
    labels,
  },
} as const;

let disposeApp: (() => void) | undefined;
const pageHost = createTestPageHost(reorderPdfProtocol, sendMessage);

async function mountAndInit(): Promise<void> {
  disposeApp = render(() => <App host={pageHost} />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function isReorderHostToWebviewMessage(value: unknown): boolean {
  return reorderPdfProtocol.parseHostToWebview(value) !== undefined;
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
  renderBehavior.pages = 4;
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  disposeApp?.();
  disposeApp = undefined;
  await flushPromises();
});

test('Applyで初期ページ順を送信する', async () => {
  expect(isReorderHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 2, 3, 4] },
  });
});

test('33ページ以上のPDFで制限メッセージなしでApplyを有効化し、全ページを送信する', async () => {
  const largeMessage = {
    ...initMessage,
    payload: { ...initMessage.payload, pageCount: 33 },
  } as const;
  expect(isReorderHostToWebviewMessage(largeMessage)).toBe(true);
  renderBehavior.pages = 33;

  disposeApp = render(() => <App host={pageHost} />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: largeMessage }));
  await flushPromises();

  expect(document.querySelector('[role="alert"]')).toBeNull();

  const applyButton = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Apply');
  expect(applyButton?.hasAttribute('disabled')).toBe(false);

  expect(pageFigures()).toHaveLength(33);
  expect(orderFromDom()).toEqual(Array.from({ length: 33 }, (_, index) => index + 1));

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: Array.from({ length: 33 }, (_, index) => index + 1) },
  });
});

test('33ページ以上のPDFで1ページ移動しても全ページを重複・欠落なく送信する', async () => {
  const largeMessage = {
    ...initMessage,
    payload: { ...initMessage.payload, pageCount: 33 },
  } as const;
  renderBehavior.pages = 33;

  disposeApp = render(() => <App host={pageHost} />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: largeMessage }));
  await flushPromises();

  const { up } = controlsFor(2);
  up?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  expect(orderFromDom()).toEqual([1, 3, 2, ...Array.from({ length: 30 }, (_, index) => index + 4)]);

  clickButton('Apply');

  const sent = sendMessage.mock.calls.at(-1)?.[0];
  expect(sent).toEqual({
    type: 'apply',
    payload: { order: [1, 3, 2, ...Array.from({ length: 30 }, (_, index) => index + 4)] },
  });
  const order = extractOrder(sent);
  expect(order).toHaveLength(33);
  expect(new Set(order).size).toBe(33);
  expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 33 }, (_, index) => index + 1));
});

function extractOrder(message: unknown): number[] {
  if (
    typeof message === 'object' &&
    message !== null &&
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload !== null &&
    'order' in message.payload &&
    Array.isArray(message.payload.order)
  ) {
    return message.payload.order;
  }
  throw new Error('apply message did not contain an order array.');
}

test('33ページ以上のPDFで全ページ分のフレームをDOMに作成する', async () => {
  const largeMessage = {
    ...initMessage,
    payload: { ...initMessage.payload, pageCount: 33 },
  } as const;
  renderBehavior.pages = 33;

  disposeApp = render(() => <App host={pageHost} />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: largeMessage }));
  await flushPromises();

  expect(pageFigures()).toHaveLength(33);
  const canvasCount = [...document.querySelectorAll('canvas')].length;
  expect(canvasCount).toBe(33);
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

test('各pageの↑/↓ボタンはgw-toolbar-buttonのCodiconボタンで、aria-labelを維持する', async () => {
  await mountAndInit();

  const { up, down } = controlsFor(0);
  expect(up?.className).toContain('gw-toolbar-button');
  expect(down?.className).toContain('gw-toolbar-button');
  expect(up?.getAttribute('aria-label')).toBe('Move page up');
  expect(down?.getAttribute('aria-label')).toBe('Move page down');
  expect(up?.querySelector('.codicon.codicon-chevron-up')).not.toBeNull();
  expect(down?.querySelector('.codicon.codicon-chevron-down')).not.toBeNull();
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

test('renderPdfPagesにvirtualize: falseを渡して全ページをDOMへマウントする', async () => {
  renderBehavior.pages = 40;
  const largeMessage = {
    ...initMessage,
    payload: { ...initMessage.payload, pageCount: 40 },
  } as const;

  disposeApp = render(() => <App host={pageHost} />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: largeMessage }));
  await flushPromises();

  const renderOptions = renderPdfPages.mock.calls[0]?.[2];
  expect(renderOptions).toEqual(expect.objectContaining({ virtualize: false }));
  expect(pageFigures()).toHaveLength(40);
  expect(orderFromDom()).toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
});
