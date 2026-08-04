import { render } from 'solid-js/web';

import { isReorderPdfHostToWebviewMessage, type ReorderPdfLabels } from '@graphics-workbench-reorder-pdf-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async (_pdfSrc: unknown, container: unknown) => {
    if (container instanceof Element) {
      for (let page = 1; page <= 4; page += 1) {
        const figure = document.createElement('figure');
        figure.setAttribute('data-pdf-page', String(page));
        const canvas = document.createElement('canvas');
        figure.append(canvas);
        container.append(figure);
      }
    }
    return {
      firstPageReady: Promise.resolve(),
      dispose: async () => {
        // noop
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
    applyError: 'PDF preview must render before applying.',
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

async function mountAndInit(): Promise<void> {
  render(() => <App />, document.querySelector('#root')!);
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

beforeEach(async () => {
  sendMessage.mockClear();
  renderPdfPages.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

test('Applyで初期ページ順を送信する', async () => {
  expect(isReorderPdfHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 2, 3, 4] },
  });
});

test('ページを上へ移動してApplyで新しい順序を送信する', async () => {
  await mountAndInit();

  const pages = [...document.querySelectorAll('[data-pdf-page]')];
  const page3Controls = pages[2]?.querySelector('.reorder-page__move-up');
  page3Controls?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 3, 2, 4] },
  });
});

test('ページを下へ移動してApplyで新しい順序を送信する', async () => {
  await mountAndInit();

  const pages = [...document.querySelectorAll('[data-pdf-page]')];
  const page2Controls = pages[1]?.querySelector('.reorder-page__move-down');
  page2Controls?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();

  clickButton('Apply');

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { order: [1, 3, 2, 4] },
  });
});
