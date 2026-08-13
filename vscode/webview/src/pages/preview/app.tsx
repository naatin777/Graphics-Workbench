import { Show, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { previewProtocol, type PreviewHostToWebview } from '@graphics-workbench/vscode-protocol/preview-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { createPdfPreview, useCurrentPage } from '../../shared/pdf/create_pdf_preview';
import { toErrorMessage } from '../../shared/error';
import { PageNavigator } from '../../shared/ui/PageNavigator';
import { ToolbarButton } from '../../shared/ui/ToolbarButton';

import { renderTiffPreview, type TiffRenderController } from './tiff_preview';
import { readPreviewLabels, type PreviewLabels } from './labels';
import {
  applyPreviewZoom,
  capturePreviewZoomAnchor,
  clampPreviewZoom,
  restorePreviewZoomAnchor,
} from '@webview-shared/pdf/preview_zoom';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

export type PreviewInitPayload = Extract<PreviewHostToWebview, { type: 'init' }>['payload'];

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(previewProtocol, properties.host);
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [labelsCatalog, setLabelsCatalog] = createSignal<MessageCatalog>({});
  const labels = (): PreviewLabels => readPreviewLabels(labelsCatalog());
  const [renderError, setRenderError] = createSignal('');
  const [previewZoom, setPreviewZoom] = createSignal(1);

  let pagesContainer: HTMLDivElement | undefined;
  let previewElement: HTMLElement | undefined;
  let tiffRenderController: TiffRenderController | undefined;
  let tiffAbortController: AbortController | undefined;

  const preview = createPdfPreview({
    pagesContainer: () => pagesContainer,
    scrollContainer: () => pagesContainer,
    pageCount,
    setRenderError,
    onRenderError: (message) => {
      channel.send.previewLoadFailed({ message });
    },
  });
  const currentPage = useCurrentPage(preview);

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
      tiffAbortController?.abort();
      tiffRenderController?.dispose();
    });
  });

  const startRender = (payload: PreviewInitPayload): void => {
    preview.dispose();
    tiffAbortController?.abort();
    tiffRenderController?.dispose();
    tiffRenderController = undefined;

    setFileName(payload.fileName);
    setPageCount(payload.pageCount);
    setLabelsCatalog(payload.labels);
    setRenderError('');
    setPreviewZoom(1);

    if (!pagesContainer) {
      return;
    }

    if (payload.format === 'pdf') {
      void preview.start(
        payload.pdfSrc,
        {
          preview: payload.preview,
          resources: payload.resources,
          page: {
            label: labels().page.label,
            onCreated: (pageFrame) => {
              pageFrame.classList.add('preview-page');
            },
          },
          ...(previewElement === undefined ? {} : { root: previewElement }),
        },
        () => {
          applyPreviewZoom(pagesContainer, previewZoom());
        },
      );
    } else {
      startTiffRender(payload);
    }
  };

  const startTiffRender = (payload: PreviewInitPayload): void => {
    if (!pagesContainer) {
      return;
    }
    const abortController = new AbortController();
    tiffAbortController = abortController;
    tiffRenderController = renderTiffPreview({
      container: pagesContainer,
      pageCount: payload.pageCount,
      pageLabel: labels().page.label,
      zoom: previewZoom,
      requestPage: (page) => {
        channel.send.renderPage({ page });
      },
      onRenderError: (error) => {
        if (abortController.signal.aborted) {
          return;
        }
        setRenderError(toErrorMessage(error));
      },
      root: pagesContainer,
      signal: abortController.signal,
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
    const anchor = capturePreviewZoomAnchor(pagesContainer, anchorTarget, clientX, clientY);
    setPreviewZoom(nextZoom);
    tiffRenderController?.applyZoom();
    applyPreviewZoom(pagesContainer, nextZoom);
    restorePreviewZoomAnchor(pagesContainer, anchor);
    requestAnimationFrame(() => {
      preview.recomputeCurrentPage();
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
    <Show when={Object.keys(labelsCatalog()).length > 0}>
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
                currentPage={currentPage() ?? 0}
                pageCount={pageCount()}
                onPrevious={preview.goToPreviousPage}
                onNext={preview.goToNextPage}
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
