import { render } from 'solid-js/web';

import { isRotatePdfHostToWebviewMessage, type RotatePdfLabels } from '@graphics-workbench-rotate-pdf-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async (_pdfSrc: string, container: Element) => {
    for (let page = 1; page <= 4; page += 1) {
      const figure = document.createElement('figure');
      figure.setAttribute('data-pdf-page', String(page));
      const canvas = document.createElement('canvas');
      figure.append(canvas);
      container.append(figure);
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

const labels: RotatePdfLabels = {
  header: {
    title: 'Rotate PDF',
    description: 'Select the pages to rotate and the rotation angle.',
  },
  preview: {
    title: 'PDF Preview',
    description: 'Pages selected for rotation.',
    ariaLabel: 'PDF page preview',
    renderError: 'Could not display the PDF',
    applyError: 'PDF preview must render before applying.',
  },
  rotation: {
    title: 'Rotation',
    angleLabel: 'Rotation angle',
    selectAll: 'Select all pages',
    selectAllAriaLabel: 'Toggle selection of all pages',
    pageToggle: 'Toggle page selection',
  },
  validation: {
    pagesRequired: 'Select at least one page to rotate.',
    pageOutOfRange: 'A selected page is out of range.',
    angleInvalid: 'Select a rotation angle.',
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

beforeEach(async () => {
  sendMessage.mockClear();
  renderPdfPages.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

test('3つの回転角度ラジオを表示し、Applyで選択ページと角度を送信する', async () => {
  expect(isRotatePdfHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  const radios = document.querySelectorAll<HTMLInputElement>('input[name="rotate-angle"]');
  expect(radios).toHaveLength(3);
  expect([...radios].map((radio) => radio.value)).toEqual(['90', '180', '270']);

  const pages = document.querySelectorAll('[data-pdf-page]');
  expect(pages).toHaveLength(4);

  pages[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  pages[3].dispatchEvent(new MouseEvent('click', { bubbles: true }));

  const applyButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply');
  expect(applyButton).toBeDefined();
  applyButton?.click();

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { angle: 90, pageIndices: [2, 4] },
  });
});

test('選択ページがない場合は検証エラーを表示しApplyを送信しない', async () => {
  await mountAndInit();

  const applyButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply');
  applyButton?.click();

  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply' }));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Select at least one page to rotate.');
});

test('全ページ選択トグルで全ページをApplyへ渡す', async () => {
  await mountAndInit();

  const selectAll = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Select all pages'),
  );
  selectAll?.click();

  const applyButton = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply');
  applyButton?.click();

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { angle: 90, pageIndices: [1, 2, 3, 4] },
  });
});
