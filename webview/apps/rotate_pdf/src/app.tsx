import { createSignal, For, onCleanup, onMount, type JSX } from 'solid-js';

import {
  isRotatePdfHostToWebviewMessage,
  PDF_ROTATION_ANGLES,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
} from '@graphics-workbench-rotate-pdf-protocol';
import { renderPdfPages, type PdfRenderController } from '@webview-shared/pdf/render_pdf_pages';

import { vscode } from './vscode';
import { defaultLabels } from './labels';

function cancel(): void {
  vscode.sendMessage({ type: 'cancel' });
}

export function App(): JSX.Element {
  const [labels, setLabels] = createSignal<RotatePdfLabels>(defaultLabels);
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(0);
  const [angle, setAngle] = createSignal<PdfRotationAngle>(90);
  const [applyError, setApplyError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);

  const selectedPages = new Set<number>();
  let pdfPages: HTMLDivElement | undefined;
  let renderController: PdfRenderController | undefined;
  let previewGeneration = 0;

  onMount(() => {
    const onMessage = (event: MessageEvent): void => {
      const message: unknown = event.data;

      if (!isRotatePdfHostToWebviewMessage(message)) {
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

    const onPageClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const figure = event.target.closest('[data-pdf-page]');

      if (!figure) {
        return;
      }

      const page = Number(figure.getAttribute('data-pdf-page'));

      if (Number.isInteger(page) && page >= 1) {
        togglePage(page);
      }
    };

    window.addEventListener('message', onMessage);
    pdfPages?.addEventListener('click', onPageClick);
    onCleanup(() => {
      window.removeEventListener('message', onMessage);
      pdfPages?.removeEventListener('click', onPageClick);
    });
  });

  onCleanup(() => {
    void renderController?.dispose();
  });

  async function startPreview(
    payload: Extract<RotatePdfHostToWebview, { type: 'init' }>['payload'],
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

      setPreviewReady(true);
      syncSelectionClasses();
    } catch (error) {
      if (signal.signal.aborted || generation !== previewGeneration) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      setApplyError(currentLabels.preview.renderError);
    }
  }

  function togglePage(page: number): void {
    if (selectedPages.has(page)) {
      selectedPages.delete(page);
    } else {
      selectedPages.add(page);
    }
    syncSelectionClasses();
  }

  function toggleSelectAll(): void {
    const count = pageCount();
    const next = selectedPages.size < count;
    selectedPages.clear();
    if (next) {
      for (let page = 1; page <= count; page += 1) {
        selectedPages.add(page);
      }
    }
    syncSelectionClasses();
  }

  function syncSelectionClasses(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    for (const figure of container.querySelectorAll('[data-pdf-page]')) {
      const page = Number(figure.getAttribute('data-pdf-page'));
      figure.classList.toggle('pdf-page--selected', selectedPages.has(page));
    }
  }

  function apply(): void {
    if (selectedPages.size === 0) {
      setApplyError(labels().validation.pagesRequired);
      return;
    }
    setApplyError('');
    const pageIndices = Array.from({ length: pageCount() }, (_, index) => index + 1).filter((page) =>
      selectedPages.has(page),
    );
    vscode.sendMessage({ type: 'apply', payload: { angle: angle(), pageIndices } });
  }

  return (
    <div class='rotate'>
      <header class='rotate__header'>
        <h1>{labels().header.title}</h1>
        <p class='rotate__description'>{labels().header.description}</p>
        <p class='rotate__file'>{fileName()}</p>
      </header>

      <div class='rotate__body'>
        <section class='rotate__preview'>
          <div class='rotate__preview-toolbar'>
            <span>{labels().preview.title}</span>
            <button
              type='button'
              onClick={toggleSelectAll}
              aria-label={labels().rotation.selectAllAriaLabel}
            >
              {labels().rotation.selectAll}
            </button>
          </div>
          <div
            ref={(element) => {
              pdfPages = element;
            }}
            class='rotate__pages'
            aria-label={labels().preview.ariaLabel}
          />
        </section>

        <section class='rotate__panel'>
          <fieldset class='rotate__angle'>
            <legend>{labels().rotation.title}</legend>
            <div
              class='rotate__angle-options'
              role='radiogroup'
              aria-label={labels().rotation.angleLabel}
            >
              <For each={PDF_ROTATION_ANGLES}>
                {(value) => (
                  <label>
                    <input
                      type='radio'
                      name='rotate-angle'
                      value={value}
                      checked={angle() === value}
                      onChange={() => {
                        setAngle(value);
                      }}
                    />
                    <span>{value}°</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>

          <p class='rotate__selection'>
            {labels().preview.description} {selectedPages.size}/{pageCount()}
          </p>

          {applyError() !== '' && <p role='alert'>{applyError()}</p>}

          <div class='rotate__actions'>
            <button
              type='button'
              class='rotate__apply'
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
