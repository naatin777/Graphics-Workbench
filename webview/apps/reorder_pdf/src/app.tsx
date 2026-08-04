import { createSignal, onCleanup, onMount, type JSX } from 'solid-js';

import {
  isReorderPdfHostToWebviewMessage,
  type ReorderPdfHostToWebview,
  type ReorderPdfLabels,
} from '@graphics-workbench-reorder-pdf-protocol';
import { renderPdfPages, type PdfRenderController } from '@webview-shared/pdf/render_pdf_pages';

import { vscode } from './vscode';
import { defaultLabels } from './labels';

function cancel(): void {
  vscode.sendMessage({ type: 'cancel' });
}

export function App(): JSX.Element {
  const [labels, setLabels] = createSignal<ReorderPdfLabels>(defaultLabels);
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(0);
  const [applyError, setApplyError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);

  let pdfPages: HTMLDivElement | undefined;
  let renderController: PdfRenderController | undefined;
  let previewGeneration = 0;

  onMount(() => {
    const onMessage = (event: MessageEvent): void => {
      const message: unknown = event.data;

      if (!isReorderPdfHostToWebviewMessage(message)) {
        return;
      }

      if (message.type === 'error') {
        setApplyError(message.payload.message);
        return;
      }

      const { payload } = message;
      setLabels({ ...defaultLabels, ...payload.labels });
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
    pdfPages?.addEventListener('click', onControlClick);
    onCleanup(() => {
      window.removeEventListener('message', onMessage);
      pdfPages?.removeEventListener('click', onControlClick);
    });
  });

  onCleanup(() => {
    void renderController?.dispose();
  });

  async function startPreview(
    payload: Extract<ReorderPdfHostToWebview, { type: 'init' }>['payload'],
    generation: number,
  ): Promise<void> {
    if (renderController !== undefined) {
      await renderController.dispose();
      renderController = undefined;
    }

    if (pdfPages === undefined) {
      return;
    }

    const signal = new AbortController();
    const currentLabels = labels();

    try {
      renderController = await renderPdfPages(payload.pdfSrc, pdfPages, {
        preview: payload.preview,
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
        root: pdfPages,
        pageLabel: currentLabels.preview.ariaLabel,
        signal: signal.signal,
        onRenderError: (error) => {
          if (signal.signal.aborted) {
            return;
          }
          vscode.sendMessage({
            type: 'previewLoadFailed',
            payload: { message: error instanceof Error ? error.message : String(error) },
          });
        },
      });

      await renderController.firstPageReady;

      if (generation !== previewGeneration) {
        return;
      }

      ensureControls();
      setPreviewReady(true);
    } catch (error) {
      if (signal.signal.aborted || generation !== previewGeneration) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      setApplyError(currentLabels.preview.renderError);
    }
  }

  function ensureControls(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    for (const figure of container.querySelectorAll('[data-pdf-page]')) {
      if (figure.querySelector('.reorder-page__controls')) {
        continue;
      }
      const controls = document.createElement('div');
      controls.className = 'reorder-page__controls';
      const position = document.createElement('span');
      position.className = 'reorder-page__position';
      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'reorder-page__move-up';
      up.setAttribute('aria-label', labels().order.moveUp);
      up.textContent = '↑';
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'reorder-page__move-down';
      down.setAttribute('aria-label', labels().order.moveDown);
      down.textContent = '↓';
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
    const figures = [...container.querySelectorAll('[data-pdf-page]')];
    const index = figures.indexOf(figure);
    const targetIndex = index + direction;
    const target = figures[targetIndex];

    if (target === undefined) {
      return;
    }

    if (direction < 0) {
      container.insertBefore(figure, target);
    } else {
      container.insertBefore(target, figure);
    }
    syncPositions();
  }

  function syncPositions(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const figures = [...container.querySelectorAll('[data-pdf-page]')];
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
    const order = [...container.querySelectorAll('[data-pdf-page]')].map((figure) =>
      Number(figure.getAttribute('data-pdf-page')),
    );

    if (order.length === 0) {
      setApplyError(labels().validation.orderRequired);
      return;
    }

    setApplyError('');
    vscode.sendMessage({ type: 'apply', payload: { order } });
  }

  return (
    <div class='reorder'>
      <header class='reorder__header'>
        <h1>{labels().header.title}</h1>
        <p class='reorder__description'>{labels().header.description}</p>
        <p class='reorder__file'>{fileName()}</p>
      </header>

      <div class='reorder__body'>
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
        </section>

        <section class='reorder__panel'>
          <p class='reorder__selection'>
            {labels().preview.description} {pageCount()} {labels().order.positionLabel}
          </p>

          {applyError() !== '' && <p role='alert'>{applyError()}</p>}

          <div class='reorder__actions'>
            <button
              type='button'
              class='reorder__apply'
              disabled={!previewReady()}
              onClick={apply}
            >
              {labels().actions.apply}
            </button>
            <button
              type='button'
              onClick={cancel}
            >
              {labels().actions.cancel}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
