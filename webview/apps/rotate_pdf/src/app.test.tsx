import { render } from 'solid-js/web';

import { isRotatePdfHostToWebviewMessage, type RotatePdfLabels } from '@graphics-workbench-rotate-pdf-protocol';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderBehavior = vi.hoisted(() => ({
  fail: false,
  disposeCount: 0,
}));
const renderPdfPages = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(async (_pdfSrc: unknown, container: unknown, options?: unknown) => {
    if (renderBehavior.fail) {
      throw new Error('render exploded');
    }
    const pageOptions = readPageOptions(options);
    if (container instanceof Element) {
      container.replaceChildren();
      for (let page = 1; page <= 4; page += 1) {
        const figure = document.createElement('figure');
        figure.className = 'pdf-page';
        figure.dataset.pdfPage = String(page);
        const canvas = document.createElement('canvas');
        figure.append(canvas);
        container.append(figure);
        pageOptions?.onCreated?.(figure, page);
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

interface PageOptions {
  onCreated?: (pageFrame: HTMLElement, pageNumber: number) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPageFrameCallback(value: unknown): value is (pageFrame: HTMLElement, pageNumber: number) => void {
  return typeof value === 'function';
}

function readPageOptions(options: unknown): PageOptions | undefined {
  if (!isRecord(options) || !('page' in options)) {
    return undefined;
  }
  const page: unknown = options.page;
  if (!isRecord(page) || !('onCreated' in page)) {
    return undefined;
  }
  const onCreated: unknown = page.onCreated;
  return isPageFrameCallback(onCreated) ? { onCreated } : {};
}

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

let disposeApp: (() => void) | undefined;

async function mountAndInit(): Promise<void> {
  disposeApp = render(() => <App />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function applyButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply');
}

function selectionText(): string {
  return document.querySelector('.rotate__selection')?.textContent ?? '';
}

function selectedPages(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.pdf-page.pdf-page--selected')].map(
    (figure) => figure.dataset.pdfPage ?? '',
  );
}

function pageFigures(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.pdf-page')];
}

function selectAllButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Select all pages'));
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

test('3つの回転角度ラジオを表示し、Applyで選択ページと角度を送信する', async () => {
  expect(isRotatePdfHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });

  const radios = document.querySelectorAll<HTMLInputElement>('input[name="rotate-angle"]');
  expect(radios).toHaveLength(3);
  expect([...radios].map((radio) => radio.value)).toEqual(['90', '180', '270']);

  const pages = document.querySelectorAll('.pdf-page');
  expect(pages).toHaveLength(4);

  pages[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  pages[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  applyButton()?.click();

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { angle: 90, pageIndices: [2, 4] },
  });
});

test('page選択で選択件数表示とselected状態が更新される', async () => {
  await mountAndInit();

  expect(selectionText()).toContain('0/4');

  pageFigures()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  expect(selectionText()).toContain('1/4');
  expect(selectedPages()).toEqual(['1']);
  expect(pageFigures()[0]?.getAttribute('aria-checked')).toBe('true');
  expect(pageFigures()[1]?.getAttribute('aria-checked')).toBe('false');

  pageFigures()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  expect(selectionText()).toContain('2/4');
  expect(selectedPages()).toEqual(['1', '2']);
});

test('選択ページがない場合は検証エラーを表示しApplyを送信しない', async () => {
  await mountAndInit();

  applyButton()?.click();

  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply' }));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Select at least one page to rotate.');
});

test('全ページ選択トグルで全ページをApplyへ渡し、再度トグルで解除する', async () => {
  await mountAndInit();

  selectAllButton()?.click();
  await flushPromises();
  expect(selectionText()).toContain('4/4');
  expect(selectedPages()).toEqual(['1', '2', '3', '4']);

  applyButton()?.click();

  expect(sendMessage).toHaveBeenLastCalledWith({
    type: 'apply',
    payload: { angle: 90, pageIndices: [1, 2, 3, 4] },
  });

  selectAllButton()?.click();
  await flushPromises();
  expect(selectionText()).toContain('0/4');
  expect(selectedPages()).toEqual([]);

  sendMessage.mockClear();
  applyButton()?.click();
  expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'apply' }));
});

test('keyboard操作でpage選択を切り替えられる', async () => {
  await mountAndInit();

  const [, , figure] = pageFigures();
  expect(figure).toBeDefined();
  expect(figure?.getAttribute('tabindex')).toBe('0');
  expect(figure?.getAttribute('role')).toBe('checkbox');

  figure?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flushPromises();
  expect(selectionText()).toContain('1/4');
  expect(selectedPages()).toEqual(['3']);

  figure?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await flushPromises();
  expect(selectionText()).toContain('0/4');
  expect(selectedPages()).toEqual([]);
});

test('init再受信時に選択状態がresetされる', async () => {
  await mountAndInit();

  pageFigures()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  pageFigures()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushPromises();
  expect(selectionText()).toContain('2/4');

  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
  expect(selectionText()).toContain('0/4');
  expect(selectedPages()).toEqual([]);
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
