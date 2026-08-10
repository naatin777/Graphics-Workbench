import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';

import {
  isReorderPdfHostToWebviewMessage,
  type ReorderPdfHostToWebview,
  type ReorderPdfLabels,
} from '@graphics-workbench-reorder-pdf-protocol';
import { renderPdfPages, type PdfRenderController } from '@webview-shared/pdf/render_pdf_pages';
import { toErrorMessage } from '@webview-shared/error';
import { SplitPane } from '@webview-shared/SplitPane';
import { Button } from '@webview-shared/ui/Button';
import { PageNavigator, scrollPageIntoView } from '@webview-shared/ui/PageNavigator';
import { useCurrentPage } from '@webview-shared/ui/use_current_page';

import { vscode } from './vscode';

function cancel(): void {
  vscode.sendMessage({ type: 'cancel' });
}

function createToolbarButton(className: string, label: string, icon: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `gw-toolbar-button ${className}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  const iconSpan = document.createElement('span');
  iconSpan.className = `codicon ${icon}`;
  iconSpan.setAttribute('aria-hidden', 'true');
  button.append(iconSpan);
  return button;
}

export function App(): JSX.Element {
  const [labelsValue, setLabels] = createSignal<ReorderPdfLabels>();
  const labels = (): ReorderPdfLabels => {
    const value = labelsValue();
    if (value === undefined) {
      throw new Error('Reorder PDF labels were not initialized.');
    }
    return value;
  };
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(0);
  const [applyError, setApplyError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);

  let pdfPages: HTMLDivElement | undefined;
  let renderController: PdfRenderController | undefined;
  let previewController: AbortController | undefined;
  let previewGeneration = 0;

  const { currentPage, recompute } = useCurrentPage({
    scrollContainer: () => pdfPages,
    getPageElements: () =>
      pdfPages === undefined ? [] : [...pdfPages.querySelectorAll<HTMLElement>('.pdf-page[data-pdf-page]')],
  });

  createEffect(() => {
    const container = pdfPages;
    const current = currentPage();
    if (container === undefined) {
      return;
    }
    for (const figure of container.querySelectorAll<HTMLElement>('.pdf-page')) {
      if (Number(figure.dataset.pdfPage) === current) {
        figure.dataset.current = 'true';
      } else {
        delete figure.dataset.current;
      }
    }
  });

  onMount(() => {
    const onMessage = (event: MessageEvent): void => {
      // oxlint-disable-next-line typescript/no-restricted-types -- webviewホストから届く未検証メッセージ。
      const message: unknown = event.data;

      if (!isReorderPdfHostToWebviewMessage(message)) {
        return;
      }

      if (message.type === 'error') {
        setApplyError(message.payload.message);
        return;
      }

      const { payload } = message;
      setLabels(payload.labels);
      setFileName(payload.fileName);
      setPageCount(payload.pageCount);
      setApplyError('');
      setPreviewReady(false);
      const generation = previewGeneration + 1;
      previewGeneration = generation;
      void startPreview(payload, generation);
    };

    const onControlClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest('button');
      const figure = button?.closest('[data-pdf-page]');

      if (!button || !figure) {
        return;
      }

      if (button.classList.contains('reorder-page__move-up')) {
        moveFigure(figure, -1);
      } else if (button.classList.contains('reorder-page__move-down')) {
        moveFigure(figure, 1);
      }
    };

    window.addEventListener('message', onMessage);
    globalThis.addEventListener('click', onControlClick);
    vscode.sendMessage({ type: 'ready' });
    onCleanup(() => {
      window.removeEventListener('message', onMessage);
      globalThis.removeEventListener('click', onControlClick);
    });
  });

  onCleanup(() => {
    previewController?.abort();
    void renderController?.dispose();
  });

  async function startPreview(
    payload: Extract<ReorderPdfHostToWebview, { type: 'init' }>['payload'],
    generation: number,
  ): Promise<void> {
    previewController?.abort();
    const controller = new AbortController();
    previewController = controller;

    if (renderController !== undefined) {
      await renderController.dispose();
      renderController = undefined;
    }

    if (pdfPages === undefined) {
      return;
    }

    const currentLabels = labels();

    try {
      renderController = await renderPdfPages(payload.pdfSrc, pdfPages, {
        virtualize: false,
        resources: payload.resources,
        preview: payload.preview,
        page: { label: currentLabels.preview.ariaLabel },
        root: pdfPages,
        signal: controller.signal,
        onRenderError: (error) => {
          if (controller.signal.aborted) {
            return;
          }
          vscode.sendMessage({
            type: 'previewLoadFailed',
            payload: { message: toErrorMessage(error) },
          });
        },
      });

      await renderController.firstPageReady;

      if (generation !== previewGeneration || controller.signal.aborted) {
        return;
      }

      ensureControls();
      recompute();
      setPreviewReady(true);
    } catch (error) {
      if (controller.signal.aborted || generation !== previewGeneration) {
        return;
      }
      const message = toErrorMessage(error);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      setApplyError(currentLabels.preview.renderError);
    }
  }

  function ensureControls(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    for (const figure of container.querySelectorAll('.pdf-page')) {
      if (figure.querySelector('.reorder-page__controls')) {
        continue;
      }
      const controls = document.createElement('div');
      controls.className = 'reorder-page__controls';
      const position = document.createElement('span');
      position.className = 'reorder-page__position';
      const up = createToolbarButton('reorder-page__move-up', labels().order.moveUp, 'codicon-chevron-up');
      const down = createToolbarButton('reorder-page__move-down', labels().order.moveDown, 'codicon-chevron-down');
      controls.append(position, up, down);
      figure.append(controls);
    }
    syncPositions();
  }

  function moveFigure(figure: Element, direction: -1 | 1): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const figures = [...container.querySelectorAll('.pdf-page')];
    const index = figures.indexOf(figure);
    const targetIndex = index + direction;
    const target = figures[targetIndex];

    if (target === undefined) {
      return;
    }

    if (direction < 0) {
      target.before(figure);
    } else {
      figure.before(target);
    }
    syncPositions();
    recompute();
  }

  function syncPositions(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const figures = [...container.querySelectorAll('.pdf-page')];
    for (const [position, figure] of figures.entries()) {
      const label = figure.querySelector('.reorder-page__position');
      if (label) {
        label.textContent = String(position + 1);
      }
    }
  }

  function scrollToPdfPage(pageNumber: number): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const figure = container.querySelector<HTMLElement>(`.pdf-page[data-pdf-page="${pageNumber}"]`);
    if (figure) {
      scrollPageIntoView(figure);
    }
  }

  function apply(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const order = [...container.querySelectorAll<HTMLElement>('.pdf-page')].map((figure) =>
      Number(figure.dataset.pdfPage),
    );

    if (order.length === 0) {
      setApplyError(labels().validation.orderRequired);
      return;
    }

    setApplyError('');
    vscode.sendMessage({ type: 'apply', payload: { order } });
  }

  return (
    <Show when={labelsValue()}>
      {(_labels) => (
        <div class='reorder'>
          <header class='reorder__header'>
            <h1>{labels().header.title}</h1>
            <p class='reorder__description'>{labels().header.description}</p>
            <p class='reorder__file'>{fileName()}</p>
          </header>

          <SplitPane
            left={
              <section class='reorder__preview'>
                <div class='reorder__preview-toolbar'>
                  <span>{labels().preview.title}</span>
                </div>
                <div
                  ref={(element) => {
                    pdfPages = element;
                  }}
                  class='reorder__pages'
                  aria-label={labels().preview.ariaLabel}
                />
                <PageNavigator
                  currentPage={currentPage()}
                  pageCount={pageCount()}
                  onPrevious={() => {
                    scrollToPdfPage(currentPage() - 1);
                  }}
                  onNext={() => {
                    scrollToPdfPage(currentPage() + 1);
                  }}
                />
              </section>
            }
            right={
              <section class='reorder__panel'>
                <p class='reorder__selection'>
                  {pageCount()} {labels().order.positionLabel}
                </p>

                {applyError() !== '' && <p role='alert'>{applyError()}</p>}

                <div class='reorder__actions'>
                  <Button
                    variant='primary'
                    disabled={!previewReady()}
                    onClick={apply}
                  >
                    {labels().actions.apply}
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
      )}
    </Show>
  );
}
