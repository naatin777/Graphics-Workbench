import { render } from 'solid-js/web';

import type { CropPdfLabels, ExtensionToWebviewMessage } from './messages';
import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());
const renderPdfPages = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock('./vscode', () => ({
  vscode: { sendMessage },
}));
vi.mock('../../../shared/pdf/render_pdf_pages', () => ({ renderPdfPages }));

const labels: CropPdfLabels = {
  header: {
    title: 'Custom Crop',
    description: 'Adjust the PDF crop area.',
    pageLabel: 'Page',
    pages: 'pages',
  },
  preview: {
    title: 'Preview',
    description: 'Zoom does not change crop values in PDF points.',
    ariaLabel: 'PDF preview',
    zoomLabel: 'Preview zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    renderError: 'Could not display the PDF',
    applyError: 'PDF preview must render before applying.',
  },
  cropBox: {
    settingsLabel: 'Crop settings',
    title: 'Crop box',
    description: 'Set the area to keep in PDF points.',
    left: 'Left',
    bottom: 'Bottom',
    right: 'Right',
    top: 'Top',
    currentPageSize: 'Current page size',
  },
  targetPages: {
    title: 'Target pages',
    all: 'All pages',
    selected: 'Selected pages',
    inputLabel: 'Pages',
    placeholder: 'Example: 1, 3, 5',
  },
  validation: {
    cropBoxNumber: '{0} must be a number.',
    cropBoxSize: 'Crop box must have positive width and height.',
    pagesRequired: 'At least one page must be selected.',
    pageWholeNumber: 'Page must be a whole number: {0}',
    pageOutOfRange: 'Selected page is out of range: {0}',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
  },
};

const initMessage: ExtensionToWebviewMessage = {
  type: 'init',
  payload: {
    fileName: 'source.pdf',
    pageCount: 2,
    initialPage: 1,
    width: 600,
    height: 800,
    pdfSrc: 'vscode-resource://source.pdf',
    resources: {
      workerSrc: '',
      cMapUrl: '',
      standardFontDataUrl: '',
      wasmUrl: '',
    },
    labels,
  },
};

describe('Crop PDF Webview', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    sendMessage.mockReset();
    renderPdfPages.mockResolvedValue({ firstPageReady: Promise.resolve(), dispose: vi.fn<() => void>() });
    const root = document.querySelector('#root');

    if (!root) {
      throw new Error('Test root was not created.');
    }

    dispose = render(() => <App />, root);
    globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  });

  afterEach(() => {
    dispose?.();
    document.body.innerHTML = '';
  });

  test('shows input errors, toggles selected pages, and applies the target', async () => {
    await flushPromises();
    sendMessage.mockClear();

    const radios = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1]?.click();

    const selectedPages = document.querySelector<HTMLInputElement>('input[type="text"]');
    if (!selectedPages) {
      throw new Error('Selected pages input was not rendered.');
    }

    expect(selectedPages.disabled).toBe(false);
    setInput(selectedPages, '2');

    const left = findNumberInput('Left');
    setInput(left, '1000');
    document.querySelector<HTMLButtonElement>('button.button--primary')?.click();
    await flushPromises();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain('positive width and height');
    expect(sendMessage).not.toHaveBeenCalledWith({
      type: 'apply',
      payload: { cropBox: expect.anything(), target: expect.anything() },
    });

    setInput(left, '0');
    document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')?.click();
    expect(document.querySelector('.zoom__value')?.textContent).toBe('125%');
    document.querySelector<HTMLButtonElement>('button.button--primary')?.click();
    await flushPromises();

    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'apply',
      payload: {
        cropBox: { left: 0, bottom: 0, right: 600, top: 800 },
        target: { type: 'selected', pages: [2] },
      },
    });
  });
});

function findNumberInput(label: string): HTMLInputElement {
  const field = [...document.querySelectorAll('label.field')].find(
    (candidate) => candidate.querySelector('.field__label')?.textContent === label,
  );
  const input = field?.querySelector('input');

  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`${label} input was not rendered.`);
  }

  return input;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
