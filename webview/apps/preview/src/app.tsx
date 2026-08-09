import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import { renderPdfPages, type PdfRenderController, type PdfRenderOptions } from '../../../shared/pdf/render_pdf_pages';
import { toErrorMessage } from '../../../shared/error';
import { PageNavigator, scrollPageIntoView } from '../../../shared/ui/PageNavigator';
import { ToolbarButton } from '../../../shared/ui/ToolbarButton';
import { useCurrentPage } from '../../../shared/ui/use_current_page';

import type {
  ExtensionToWebviewMessage,
  PreviewInitPayload,
  PreviewLabels,
  WebviewToExtensionMessage,
} from './messages';
import { renderTiffPreview, type TiffRenderController } from './tiff_preview';
import { vscode } from './vscode';

const defaultLabels: PreviewLabels = {
  title: 'Preview',
  description: 'Preview the file contents.',
  page: {
    label: 'Page',
    pages: 'pages',
  },
  preview: {
    ariaLabel: 'Preview',
    zoomLabel: 'Preview zoom',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    renderError: 'Could not display the preview',
  },
};

/** Decodes the base64-encoded PDF bytes sent over Webview postMessage. */
function decodeBase64PdfData(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function App(): JSX.Element {
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [labels, setLabels] = createSignal(defaultLabels);
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
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      const message = event.data;
      if (message.type === 'init') {
        startRender(message.payload);
        return;
      }
      if (message.type === 'renderPageResult') {
        tiffRenderController?.setPageSrc(message.payload.page, message.payload.dataUri);
        return;
      }
      // The only remaining validated message type is `error`.
      setRenderError(message.payload.message);
    };

    window.addEventListener('message', handleMessage);
    vscode.sendMessage({ type: 'ready' });
    onCleanup(() => {
      window.removeEventListener('message', handleMessage);
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

  const renderPdfPreview = async (payload: PreviewInitPayload, signal: AbortSignal): Promise<void> => {
    if (!pagesContainer) {
      return;
    }
    try {
      const options = createPdfRenderOptions(payload, signal);
      const controller = await renderPdfPages('', pagesContainer, options);
      if (signal.aborted) {
        await controller.dispose();
        return;
      }
      pdfRenderController = controller;
      await controller.firstPageReady;
      applyPdfPreviewZoom();
      requestAnimationFrame(() => {
        recomputeCurrentPage();
      });
    } catch (error: unknown) {
      if (signal.aborted) {
        return;
      }
      const message = toErrorMessage(error);
      setRenderError(message);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
    }
  };

  const createPdfRenderOptions = (payload: PreviewInitPayload, signal: AbortSignal): PdfRenderOptions => {
    const options: PdfRenderOptions = {
      preview: payload.preview,
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
      page: {
        label: payload.labels.page.label,
        onCreated: (pageFrame) => {
          pageFrame.classList.add('preview-page');
        },
      },
      signal,
      onRenderError: (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        const message = toErrorMessage(error);
        setRenderError(message);
        vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      },
    };
    if (payload.pdfData !== undefined) {
      options.data = decodeBase64PdfData(payload.pdfData);
    }
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
        const message: Extract<WebviewToExtensionMessage, { type: 'renderPage' }> = {
          type: 'renderPage',
          payload: { page },
        };
        vscode.sendMessage(message);
      },
      onRenderError: (error: unknown) => {
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

  const applyPdfPreviewZoom = (): void => {
    if (!pagesContainer) {
      return;
    }
    const zoom = previewZoom();
    for (const canvas of pagesContainer.querySelectorAll<HTMLCanvasElement>('canvas[data-pdf-page]')) {
      const width = Number(canvas.dataset.pdfWidth);
      const height = Number(canvas.dataset.pdfHeight);
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        continue;
      }
      canvas.style.width = `${width * zoom}px`;
      canvas.style.height = `${height * zoom}px`;
    }
  };

  const updatePreviewZoom = (value: number): void => {
    const nextZoom = Math.min(4, Math.max(0.25, Math.round(value * 100) / 100));
    if (nextZoom === previewZoom()) {
      return;
    }
    setPreviewZoom(nextZoom);
    tiffRenderController?.applyZoom();
    applyPdfPreviewZoom();
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
    updatePreviewZoom(previewZoom() + (event.deltaY < 0 ? 0.1 : -0.1));
  };

  return (
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
  );
}
