import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { renderPdfPages, type PdfRenderController } from '../../shared/pdf/render_pdf_pages';
import { toErrorMessage } from '../../shared/error';
import { SplitPane } from '@webview-shared/SplitPane';
import { Button } from '../../shared/ui/Button';
import { PageNavigator, scrollPageIntoView } from '../../shared/ui/PageNavigator';
import { ToolbarButton } from '../../shared/ui/ToolbarButton';
import { useCurrentPage } from '../../shared/ui/use_current_page';

import { parseCropBox, parseTarget } from './crop_input';
import type { CropPdfLabels, ExtensionToWebviewMessage } from './messages';
import {
  applyPreviewZoom,
  capturePreviewZoomAnchor,
  clampPreviewZoom,
  restorePreviewZoomAnchor,
} from '@webview-shared/pdf/preview_zoom';
import { vscode } from './vscode';

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
  vscode.send.cancel();
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
  } catch (error) {
    if (options.signal.aborted) {
      return;
    }
    options.state.setRenderError(toErrorMessage(error));
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
    resources: payload.resources,
    page: { label: payload.labels.header.pageLabel },
    signal,
    onRenderError: (error) => {
      if (signal.aborted) {
        return;
      }
      const message = toErrorMessage(error);
      setRenderError(message);
      vscode.send.previewLoadFailed({ message });
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
  const [labelsValue, setLabels] = createSignal<CropPdfLabels>();
  const labels = (): CropPdfLabels => {
    const value = labelsValue();
    if (value === undefined) {
      throw new Error('Crop PDF labels were not initialized.');
    }
    return value;
  };
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
    const unsubscribeMessages = vscode.on({
      error: ({ message }) => {
        setIsApplying(false);
        setInputError(message);
      },
      init: (payload) => {
        const { initialPage } = payload;
        const totalPages = payload.pageCount;
        const initialGeometry = initialPageGeometry(payload);

        setFileName(payload.fileName);
        setLabels(payload.labels);
        setPageCount(totalPages);
        setPageSize(initialGeometry.pageSize);
        setCropBox(initialGeometry.cropBox);
        setTargetType('all');
        setSelectedPages(initialPage.toString());
        setInputError('');
        setRenderError('');
        setIsApplying(false);
        const pages = pdfPages;
        if (pages === undefined) {
          return;
        }

        renderAbortController?.abort();
        void renderController?.dispose();
        renderController = undefined;
        const abortController = new AbortController();
        renderAbortController = abortController;
        renderPromise = renderPreview({
          payload,
          pdf: {
            pages,
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
      },
    });

    vscode.send.ready();
    onCleanup(() => {
      unsubscribeMessages();
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

    setIsApplying(true);
    vscode.send.apply({
      cropBox: parsedCropBox.value,
      target: target.value,
    });
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
    <Show when={labelsValue()}>
      {(_labels) => (
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
                          class='gw-input'
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
                          class='gw-input'
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
                          class='gw-input'
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
                          class='gw-input'
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

                  <fieldset class='gw-radio-group'>
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
                        class='gw-input'
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
      )}
    </Show>
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
