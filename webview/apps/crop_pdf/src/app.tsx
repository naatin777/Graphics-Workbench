import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { renderPdfPages, type PdfRenderController } from '../../../shared/pdf/render_pdf_pages';
import { SplitPane } from '@webview-shared/SplitPane';
import { Button } from '../../../shared/ui/Button';
import { PageNavigator, scrollPageIntoView } from '../../../shared/ui/PageNavigator';
import { ToolbarButton } from '../../../shared/ui/ToolbarButton';
import { useCurrentPage } from '../../../shared/ui/use_current_page';

import { parseCropBox, parseTarget } from './crop_input';
import type { CropPdfLabels, ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messages';
import { applyPreviewZoom, capturePreviewZoomAnchor, clampPreviewZoom, restorePreviewZoomAnchor } from './preview_zoom';
import { vscode } from './vscode';

const defaultLabels: CropPdfLabels = {
  header: {
    title: 'Custom Crop',
    description: 'Adjust the PDF crop area.',
    pageLabel: 'Page',
    pages: 'pages',
  },
  preview: {
    title: 'Preview',
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
    left: 'Left',
    bottom: 'Bottom',
    right: 'Right',
    top: 'Top',
    currentPageSize: 'Page size',
  },
  targetPages: {
    applyTo: 'Apply to',
    all: 'All pages',
    pages: 'Pages',
    inputLabel: 'Pages',
    placeholder: '1, 3–5',
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
    processing: 'Processing…',
    cancel: 'Cancel',
  },
};

type CropInitPayload = Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'];
type PageSize = { width: number; height: number; x: number; y: number };
type CropBoxState = { left: string; bottom: string; right: string; top: string };
type RenderPreviewOptions = {
  payload: CropInitPayload;
  pdf: {
    pages: HTMLDivElement;
    preview: HTMLElement | undefined;
    zoom: () => number;
  };
  state: {
    pageSize: () => PageSize;
    cropBox: () => CropBoxState;
    setPageSize: (value: PageSize) => void;
    setCropBox: (value: CropBoxState) => void;
    setRenderError: (value: string) => void;
    setRenderController: (value: PdfRenderController) => void;
  };
  signal: AbortSignal;
};

function cancel(): void {
  const message: WebviewToExtensionMessage = { type: 'cancel' };
  vscode.sendMessage(message);
}

async function renderPreview(options: RenderPreviewOptions): Promise<void> {
  try {
    const controller = await renderPdfPages(
      options.payload.pdfSrc,
      options.pdf.pages,
      renderOptions(options.payload, options.pdf.preview, options.state.setRenderError, options.signal),
    );
    if (options.signal.aborted) {
      await controller.dispose();
      return;
    }
    options.state.setRenderController(controller);
    await controller.firstPageReady;
    applyPreviewZoom(options.pdf.pages, options.pdf.zoom());
    updatePreviewPageSize(options);
  } catch (error: unknown) {
    if (options.signal.aborted) {
      return;
    }
    options.state.setRenderError(error instanceof Error ? error.message : String(error));
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function renderOptions(
  payload: CropInitPayload,
  pdfPreview: HTMLElement | undefined,
  setRenderError: (value: string) => void,
  signal: AbortSignal,
): Parameters<typeof renderPdfPages>[2] {
  return {
    preview: payload.preview,
    ...(pdfPreview !== undefined && { root: pdfPreview }),
    resources: {
      ...(payload.resources.workerSrc !== undefined && payload.resources.workerSrc !== ''
        ? { workerSrc: payload.resources.workerSrc }
        : {}),
      ...(payload.resources.cMapUrl !== undefined && payload.resources.cMapUrl !== ''
        ? { cMapUrl: payload.resources.cMapUrl }
        : {}),
      ...(payload.resources.standardFontDataUrl !== undefined && payload.resources.standardFontDataUrl !== ''
        ? { standardFontDataUrl: payload.resources.standardFontDataUrl }
        : {}),
      ...(payload.resources.wasmUrl !== undefined && payload.resources.wasmUrl !== ''
        ? { wasmUrl: payload.resources.wasmUrl }
        : {}),
    },
    page: { label: payload.labels.header.pageLabel },
    signal,
    onRenderError: (error: unknown) => {
      if (signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setRenderError(message);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
    },
  };
}

function updatePreviewPageSize(options: {
  pdf: Pick<RenderPreviewOptions['pdf'], 'pages'>;
  state: Pick<RenderPreviewOptions['state'], 'pageSize' | 'cropBox' | 'setPageSize' | 'setCropBox'>;
}): void {
  const size = getPreviewPageSize(options.pdf.pages);
  if (
    !(
      size.width > 0 &&
      size.height > 0 &&
      options.state.pageSize().width === 0 &&
      options.state.pageSize().height === 0
    )
  ) {
    return;
  }

  options.state.setPageSize(size);
  if (!isDefaultCropBox(options.state.cropBox())) {
    return;
  }

  options.state.setCropBox({
    left: '0',
    bottom: '0',
    right: size.width.toString(),
    top: size.height.toString(),
  });
}

function initialPageGeometry(payload: CropInitPayload): {
  pageSize: PageSize;
  cropBox: CropBoxState;
} {
  const [geometry] = payload.pageGeometry;
  if (!geometry) {
    return {
      pageSize: { x: 0, y: 0, width: 0, height: 0 },
      cropBox: { left: '0', bottom: '0', right: '0', top: '0' },
    };
  }

  return {
    pageSize: {
      x: geometry.mediaBox.x,
      y: geometry.mediaBox.y,
      width: geometry.mediaBox.width,
      height: geometry.mediaBox.height,
    },
    cropBox: {
      left: payload.initialCropBox.left.toString(),
      bottom: payload.initialCropBox.bottom.toString(),
      right: payload.initialCropBox.right.toString(),
      top: payload.initialCropBox.top.toString(),
    },
  };
}

function isDefaultCropBox(cropBox: CropBoxState): boolean {
  return cropBox.left === '0' && cropBox.bottom === '0' && cropBox.right === '0' && cropBox.top === '0';
}

export function App(): JSX.Element {
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [pageSize, setPageSize] = createSignal({ x: 0, y: 0, width: 0, height: 0 });
  const [cropBox, setCropBox] = createSignal({
    left: '0',
    bottom: '0',
    right: '0',
    top: '0',
  });
  const [targetType, setTargetType] = createSignal<'all' | 'selected'>('all');
  const [selectedPages, setSelectedPages] = createSignal('1');
  const [previewZoom, setPreviewZoom] = createSignal(1);
  const [labels, setLabels] = createSignal(defaultLabels);
  const [renderError, setRenderError] = createSignal('');
  const [inputError, setInputError] = createSignal('');
  const [isApplying, setIsApplying] = createSignal(false);
  let pdfPages: HTMLDivElement | undefined;
  let pdfPreview: HTMLElement | undefined;
  let renderPromise: Promise<void> | undefined;
  let renderController: PdfRenderController | undefined;
  let renderAbortController: AbortController | undefined;

  const { currentPage, recompute: recomputeCurrentPage } = useCurrentPage({
    scrollContainer: () => pdfPreview,
    getPageElements: () => (pdfPages ? [...pdfPages.querySelectorAll<HTMLElement>('.pdf-page[data-pdf-page]')] : []),
  });

  const goToPreviousPage = (): void => {
    const target = pdfPages?.querySelector<HTMLElement>(`[data-pdf-page="${Math.max(currentPage() - 1, 1)}"]`);
    if (target) {
      scrollPageIntoView(target);
    }
  };

  const goToNextPage = (): void => {
    const target = pdfPages?.querySelector<HTMLElement>(
      `[data-pdf-page="${Math.min(currentPage() + 1, pageCount())}"]`,
    );
    if (target) {
      scrollPageIntoView(target);
    }
  };

  // Re-evaluate the current page after the PDF renders or the page count changes.
  createEffect(() => {
    void pageCount();
    void renderError();
    requestAnimationFrame(() => {
      recomputeCurrentPage();
    });
  });

  // Sync the current-page outline onto the rendered page elements.
  createEffect(() => {
    const current = currentPage();
    for (const page of pdfPages?.querySelectorAll<HTMLElement>('.pdf-page[data-pdf-page]') ?? []) {
      if (page.dataset.pdfPage === String(current)) {
        page.dataset.current = 'true';
      } else {
        delete page.dataset.current;
      }
    }
  });

  onMount(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      if (!pdfPages) {
        return;
      }

      if (event.data.type === 'error') {
        setIsApplying(false);
        setInputError(event.data.payload.message);
        return;
      }

      renderAbortController?.abort();
      void renderController?.dispose();
      renderController = undefined;
      const abortController = new AbortController();
      renderAbortController = abortController;

      const { initialPage } = event.data.payload;
      const totalPages = event.data.payload.pageCount;
      const initialGeometry = initialPageGeometry(event.data.payload);

      setFileName(event.data.payload.fileName);
      setLabels(event.data.payload.labels);
      setPageCount(totalPages);
      setPageSize(initialGeometry.pageSize);
      setCropBox(initialGeometry.cropBox);
      setTargetType('all');
      setSelectedPages(initialPage.toString());
      setInputError('');
      setRenderError('');
      setIsApplying(false);
      const { payload } = event.data;
      renderPromise = renderPreview({
        payload,
        pdf: {
          pages: pdfPages,
          preview: pdfPreview,
          zoom: previewZoom,
        },
        state: {
          pageSize,
          cropBox,
          setPageSize: (value) => {
            setPageSize({ ...value, x: pageSize().x, y: pageSize().y });
          },
          setCropBox: (value) => {
            setCropBox(value);
          },
          setRenderError: (value) => {
            setRenderError(value);
          },
          setRenderController: (controller) => {
            renderController = controller;
          },
        },
        signal: abortController.signal,
      });
    };

    window.addEventListener('message', handleMessage);
    vscode.sendMessage({ type: 'ready' });
    onCleanup(() => {
      window.removeEventListener('message', handleMessage);
      renderAbortController?.abort();
      void renderController?.dispose();
    });
  });

  const applyCrop = async (): Promise<void> => {
    if (isApplying()) {
      return;
    }

    if (!renderPromise) {
      setInputError(labels().preview.applyError);
      return;
    }

    try {
      await renderPromise;
    } catch {
      setInputError(labels().preview.applyError);
      return;
    }

    const parsedCropBox = parseCropBox(cropBox(), labels());
    const target = parseTarget(targetType(), selectedPages(), pageCount(), labels());

    if (!parsedCropBox.ok) {
      setInputError(parsedCropBox.message);
      return;
    }

    if (!target.ok) {
      setInputError(target.message);
      return;
    }

    setInputError('');

    const message: WebviewToExtensionMessage = {
      type: 'apply',
      payload: {
        cropBox: parsedCropBox.value,
        target: target.value,
      },
    };

    setIsApplying(true);
    vscode.sendMessage(message);
  };

  const updatePreviewZoom = (
    value: number,
    anchorTarget?: EventTarget | null,
    clientX?: number,
    clientY?: number,
  ): void => {
    const nextZoom = clampPreviewZoom(value);

    if (nextZoom === previewZoom()) {
      return;
    }

    const anchor = capturePreviewZoomAnchor(pdfPreview, anchorTarget, clientX, clientY);

    setPreviewZoom(nextZoom);
    applyPreviewZoom(pdfPages, nextZoom);
    restorePreviewZoomAnchor(pdfPreview, anchor);
    requestAnimationFrame(() => {
      recomputeCurrentPage();
    });
  };

  const zoomOut = (): void => {
    updatePreviewZoom(previewZoom() - 0.25);
  };

  const zoomIn = (): void => {
    updatePreviewZoom(previewZoom() + 0.25);
  };

  const zoomWithWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    updatePreviewZoom(previewZoom() + (event.deltaY < 0 ? 0.1 : -0.1), event.target, event.clientX, event.clientY);
  };

  return (
    <main class='app'>
      <h1 class='sr-only'>{labels().header.title}</h1>
      <p class='sr-only'>
        {fileName()} · {pageCount()} {labels().header.pages}. {labels().header.description}
      </p>

      <div class='workspace'>
        <SplitPane
          left={
            <section
              ref={(element) => {
                pdfPreview = element;
              }}
              aria-label={labels().preview.ariaLabel}
              class='pdf-preview'
              classList={{ 'pdf-preview--fit': previewZoom() <= 1 }}
              onWheel={zoomWithWheel}
            >
              <div class='pdf-preview__toolbar'>
                <div>
                  <h2>{labels().preview.title}</h2>
                </div>
                <div
                  class='zoom'
                  aria-label={labels().preview.zoomLabel}
                >
                  <ToolbarButton
                    icon='codicon-zoom-out'
                    label={labels().preview.zoomOut}
                    onClick={zoomOut}
                  />
                  <span class='zoom__value'>{Math.round(previewZoom() * 100)}%</span>
                  <ToolbarButton
                    icon='codicon-zoom-in'
                    label={labels().preview.zoomIn}
                    onClick={zoomIn}
                  />
                </div>
              </div>
              <div
                ref={(element) => {
                  pdfPages = element;
                }}
                class='pdf-preview__pages'
              />
              <PageNavigator
                currentPage={currentPage()}
                pageCount={pageCount()}
                onPrevious={goToPreviousPage}
                onNext={goToNextPage}
              />
              {renderError() ? (
                <p
                  class='pdf-preview__error'
                  role='alert'
                >
                  {labels().preview.renderError}: {renderError()}
                </p>
              ) : undefined}
            </section>
          }
          right={
            <section
              aria-label={labels().cropBox.settingsLabel}
              aria-busy={isApplying()}
              class='panel'
            >
              <div class='panel__group'>
                <h2>{labels().cropBox.title}</h2>

                <div class='crop-grid'>
                  <label class='field'>
                    <span class='field__label'>{labels().cropBox.left}</span>
                    <input
                      class='input gw-input'
                      disabled={isApplying()}
                      inputmode='decimal'
                      type='number'
                      value={cropBox().left}
                      onInput={(event) => {
                        setCropBox({ ...cropBox(), left: event.currentTarget.value });
                      }}
                    />
                  </label>

                  <label class='field'>
                    <span class='field__label'>{labels().cropBox.bottom}</span>
                    <input
                      class='input gw-input'
                      disabled={isApplying()}
                      inputmode='decimal'
                      type='number'
                      value={cropBox().bottom}
                      onInput={(event) => {
                        setCropBox({ ...cropBox(), bottom: event.currentTarget.value });
                      }}
                    />
                  </label>

                  <label class='field'>
                    <span class='field__label'>{labels().cropBox.right}</span>
                    <input
                      class='input gw-input'
                      disabled={isApplying()}
                      inputmode='decimal'
                      type='number'
                      value={cropBox().right}
                      onInput={(event) => {
                        setCropBox({ ...cropBox(), right: event.currentTarget.value });
                      }}
                    />
                  </label>

                  <label class='field'>
                    <span class='field__label'>{labels().cropBox.top}</span>
                    <input
                      class='input gw-input'
                      disabled={isApplying()}
                      inputmode='decimal'
                      type='number'
                      value={cropBox().top}
                      onInput={(event) => {
                        setCropBox({ ...cropBox(), top: event.currentTarget.value });
                      }}
                    />
                  </label>
                </div>

                <p class='panel__hint'>
                  {labels().cropBox.currentPageSize}: {pageSize().width} × {pageSize().height} pt
                </p>
              </div>

              <fieldset class='target gw-radio-group'>
                <legend>{labels().targetPages.applyTo}</legend>

                <label class='gw-radio-option'>
                  <input
                    checked={targetType() === 'all'}
                    disabled={isApplying()}
                    name='target'
                    type='radio'
                    onChange={() => {
                      setTargetType('all');
                    }}
                  />
                  {labels().targetPages.all}
                </label>

                <label class='gw-radio-option'>
                  <input
                    checked={targetType() === 'selected'}
                    disabled={isApplying()}
                    name='target'
                    type='radio'
                    onChange={() => {
                      setTargetType('selected');
                    }}
                  />
                  {labels().targetPages.pages}
                </label>

                <label class='field'>
                  <span class='field__label'>{labels().targetPages.inputLabel}</span>
                  <input
                    class='input gw-input'
                    disabled={isApplying() || targetType() !== 'selected'}
                    placeholder={labels().targetPages.placeholder}
                    type='text'
                    value={selectedPages()}
                    onInput={(event) => {
                      setSelectedPages(event.currentTarget.value);
                    }}
                  />
                </label>
              </fieldset>

              {inputError() ? (
                <p
                  class='panel__error'
                  role='alert'
                >
                  {inputError()}
                </p>
              ) : undefined}

              <div class='actions gw-actions'>
                <Button
                  variant='primary'
                  disabled={isApplying()}
                  onClick={() => {
                    void applyCrop();
                  }}
                >
                  {isApplying() ? labels().actions.processing : labels().actions.apply}
                </Button>
                <Button
                  variant='secondary'
                  onClick={cancel}
                >
                  {labels().actions.cancel}
                </Button>
              </div>
            </section>
          }
        />
      </div>
    </main>
  );
}

function getPreviewPageSize(container: HTMLDivElement | undefined): {
  width: number;
  height: number;
  x: number;
  y: number;
} {
  const firstPageCanvas = container?.querySelector<HTMLCanvasElement>('canvas[data-pdf-page="1"]');

  if (!firstPageCanvas) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const width = Number(firstPageCanvas.dataset.pdfWidth);
  const height = Number(firstPageCanvas.dataset.pdfHeight);

  return {
    x: 0,
    y: 0,
    width: Number.isFinite(width) ? width : firstPageCanvas.width,
    height: Number.isFinite(height) ? height : firstPageCanvas.height,
  };
}
