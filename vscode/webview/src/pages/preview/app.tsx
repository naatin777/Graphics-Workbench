import { Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import {
  previewProtocol,
  type PreviewHostToWebview,
  type PreviewLabels,
} from '@graphics-workbench/vscode-protocol/preview-protocol';
import { renderPdfPages, type PdfRenderController, type PdfRenderOptions } from '../../shared/pdf/render_pdf_pages';
import { toErrorMessage } from '../../shared/error';
import { PageNavigator, scrollPageIntoView } from '../../shared/ui/PageNavigator';
import { ToolbarButton } from '../../shared/ui/ToolbarButton';
import { useCurrentPage } from '../../shared/ui/use_current_page';

import { renderTiffPreview, type TiffRenderController } from './tiff_preview';
import {
  applyPreviewZoom,
  capturePreviewZoomAnchor,
  clampPreviewZoom,
  restorePreviewZoomAnchor,
} from '@webview-shared/pdf/preview_zoom';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

export type PreviewInitPayload = Extract<PreviewHostToWebview, { type: 'init' }>['payload'];
type PdfPreviewInitPayload = Extract<PreviewInitPayload, { format: 'pdf' }>;

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(previewProtocol, properties.host);
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [labelsValue, setLabels] = createSignal<PreviewLabels>();
  const labels = (): PreviewLabels => {
    const value = labelsValue();
    if (value === undefined) {
      throw new Error('Preview labels were not initialized.');
    }
    return value;
  };
  const [renderError, setRenderError] = createSignal('');
  const [previewZoom, setPreviewZoom] = createSignal(1);

  let pagesContainer: HTMLDivElement | undefined;
  let previewElement: HTMLElement | undefined;
  let pdfRenderController: PdfRenderController | undefined;
  let tiffRenderController: TiffRenderController | undefined;
  let renderAbortController: AbortController | undefined;

  const { currentPage, recompute: recomputeCurrentPage } = useCurrentPage({
    scrollContainer: () => pagesContainer,
    getPageElements: () =>
      pagesContainer ? [...pagesContainer.querySelectorAll<HTMLElement>('.preview-page[data-pdf-page]')] : [],
  });

  const goToPreviousPage = (): void => {
    const target = pagesContainer?.querySelector<HTMLElement>(`[data-pdf-page="${Math.max(currentPage() - 1, 1)}"]`);
    if (target) {
      scrollPageIntoView(target);
    }
  };

  const goToNextPage = (): void => {
    const target = pagesContainer?.querySelector<HTMLElement>(
      `[data-pdf-page="${Math.min(currentPage() + 1, pageCount())}"]`,
    );
    if (target) {
      scrollPageIntoView(target);
    }
  };

  // Re-evaluate the current page after the preview renders or the page count changes.
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
    for (const page of pagesContainer?.querySelectorAll<HTMLElement>('.preview-page[data-pdf-page]') ?? []) {
      if (page.dataset.pdfPage === String(current)) {
        page.dataset.current = 'true';
      } else {
        delete page.dataset.current;
      }
    }
  });

  onMount(() => {
    const unsubscribeMessages = channel.on({
      init: (payload) => {
        startRender(payload);
      },
      renderPageResult: ({ page, dataUri }) => {
        tiffRenderController?.setPageSrc(page, dataUri);
      },
      error: ({ message }) => {
        setRenderError(message);
      },
    });
    channel.send.ready();
    onCleanup(() => {
      unsubscribeMessages();
      renderAbortController?.abort();
      void pdfRenderController?.dispose();
      tiffRenderController?.dispose();
    });
  });

  const startRender = (payload: PreviewInitPayload): void => {
    renderAbortController?.abort();
    void pdfRenderController?.dispose();
    pdfRenderController = undefined;
    tiffRenderController?.dispose();
    tiffRenderController = undefined;

    setFileName(payload.fileName);
    setPageCount(payload.pageCount);
    setLabels(payload.labels);
    setRenderError('');
    setPreviewZoom(1);

    if (!pagesContainer) {
      return;
    }

    const abortController = new AbortController();
    renderAbortController = abortController;

    if (payload.format === 'pdf') {
      void renderPdfPreview(payload, abortController.signal);
    } else {
      startTiffRender(payload, abortController.signal);
    }
  };

  const renderPdfPreview = async (payload: PdfPreviewInitPayload, signal: AbortSignal): Promise<void> => {
    if (!pagesContainer) {
      return;
    }
    try {
      const options = createPdfRenderOptions(payload, signal);
      const controller = await renderPdfPages(payload.pdfSrc, pagesContainer, options);
      if (signal.aborted) {
        await controller.dispose();
        return;
      }
      pdfRenderController = controller;
      await controller.firstPageReady;
      applyPreviewZoom(pagesContainer, previewZoom());
      requestAnimationFrame(() => {
        recomputeCurrentPage();
      });
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      const message = toErrorMessage(error);
      setRenderError(message);
      channel.send.previewLoadFailed({ message });
    }
  };

  const createPdfRenderOptions = (payload: PdfPreviewInitPayload, signal: AbortSignal): PdfRenderOptions => {
    const options: PdfRenderOptions = {
      preview: payload.preview,
      resources: payload.resources,
      page: {
        label: payload.labels.page.label,
        onCreated: (pageFrame) => {
          pageFrame.classList.add('preview-page');
        },
      },
      signal,
      onRenderError: (error) => {
        if (signal.aborted) {
          return;
        }
        const message = toErrorMessage(error);
        setRenderError(message);
        channel.send.previewLoadFailed({ message });
      },
    };
    if (previewElement !== undefined) {
      options.root = previewElement;
    }
    return options;
  };

  const startTiffRender = (payload: PreviewInitPayload, signal: AbortSignal): void => {
    if (!pagesContainer) {
      return;
    }
    const controller = renderTiffPreview({
      container: pagesContainer,
      pageCount: payload.pageCount,
      pageLabel: payload.labels.page.label,
      zoom: previewZoom,
      requestPage: (page) => {
        channel.send.renderPage({ page });
      },
      onRenderError: (error) => {
        if (signal.aborted) {
          return;
        }
        const message = toErrorMessage(error);
        setRenderError(message);
      },
      root: pagesContainer,
      signal,
    });
    tiffRenderController = controller;
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
    const anchor = capturePreviewZoomAnchor(pagesContainer, anchorTarget, clientX, clientY);
    setPreviewZoom(nextZoom);
    tiffRenderController?.applyZoom();
    applyPreviewZoom(pagesContainer, nextZoom);
    restorePreviewZoomAnchor(pagesContainer, anchor);
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
          <h1 class='sr-only'>{labels().title}</h1>
          <p class='sr-only'>
            {fileName()} · {pageCount()} {labels().page.pages}. {labels().description}
          </p>

          <div class='workspace'>
            <section
              ref={(element) => {
                previewElement = element;
              }}
              aria-label={labels().preview.ariaLabel}
              class='preview'
              classList={{ 'preview--fit': previewZoom() <= 1 }}
              onWheel={zoomWithWheel}
            >
              <div class='preview__toolbar'>
                <h2>{fileName()}</h2>
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
                  pagesContainer = element;
                }}
                class='preview__pages'
              />
              <PageNavigator
                currentPage={currentPage()}
                pageCount={pageCount()}
                onPrevious={goToPreviousPage}
                onNext={goToNextPage}
              />
              {renderError() ? (
                <p
                  class='preview__error'
                  role='alert'
                >
                  {labels().preview.renderError}: {renderError()}
                </p>
              ) : undefined}
            </section>
          </div>
        </main>
      )}
    </Show>
  );
}
