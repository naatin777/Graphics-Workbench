import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';

import { reorderPdfProtocol } from '@graphics-workbench/vscode-protocol/reorder-pdf-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import { createPdfPreview, useCurrentPage } from '@webview-shared/pdf/create_pdf_preview';
import { SplitPane } from '@webview-shared/SplitPane';
import { Button } from '@webview-shared/ui/Button';
import { PageNavigator } from '@webview-shared/ui/PageNavigator';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

import { readReorderPdfLabels, type ReorderPdfLabels } from './labels';

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

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(reorderPdfProtocol, properties.host);
  const [labelsCatalog, setLabelsCatalog] = createSignal<MessageCatalog>({});
  const labels = (): ReorderPdfLabels => readReorderPdfLabels(labelsCatalog());
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(0);
  const [applyError, setApplyError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);

  let pdfPages: HTMLDivElement | undefined;

  const preview = createPdfPreview({
    pagesContainer: () => pdfPages,
    scrollContainer: () => pdfPages,
    setRenderError: () => {
      setApplyError(labels().preview.renderError);
    },
    onRenderError: (message) => {
      channel.send.previewLoadFailed({ message });
    },
  });
  const currentPage = useCurrentPage(preview);

  const cancel = (): void => {
    channel.send.cancel();
  };

  onMount(() => {
    const unsubscribeMessages = channel.on({
      error: ({ message }) => {
        setApplyError(message);
      },
      init: (payload) => {
        setLabelsCatalog(payload.labels);
        setFileName(payload.fileName);
        setPageCount(payload.pageCount);
        setApplyError('');
        setPreviewReady(false);
        void preview.start(
          payload.pdfSrc,
          {
            virtualize: false,
            resources: payload.resources,
            preview: payload.preview,
            page: { label: labels().preview.ariaLabel },
            ...(pdfPages === undefined ? {} : { root: pdfPages }),
          },
          () => {
            ensureControls();
            setPreviewReady(true);
          },
        );
      },
    });

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

    globalThis.addEventListener('click', onControlClick);
    channel.send.ready();
    onCleanup(() => {
      unsubscribeMessages();
      globalThis.removeEventListener('click', onControlClick);
    });
  });

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
    preview.recomputeCurrentPage();
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
    channel.send.apply({ order });
  }

  return (
    <Show when={Object.keys(labelsCatalog()).length > 0}>
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
                  currentPage={currentPage() ?? 0}
                  pageCount={pageCount()}
                  onPrevious={preview.goToPreviousPage}
                  onNext={preview.goToNextPage}
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
