import { createEffect, createSignal, For, onCleanup, onMount, type JSX } from 'solid-js';

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
  const [selectedPages, setSelectedPages] = createSignal<ReadonlySet<number>>(new Set());

  let pdfPages: HTMLDivElement | undefined;
  let renderController: PdfRenderController | undefined;
  let previewController: AbortController | undefined;
  let previewGeneration = 0;

  createEffect(() => {
    selectedPages();
    syncSelectionClasses();
  });

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
      setSelectedPages(new Set<number>());
      const generation = previewGeneration + 1;
      previewGeneration = generation;
      void startPreview(payload, generation);
    };

    const onPageClick = (event: MouseEvent): void => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      const figure = event.target.closest<HTMLElement>('[data-pdf-page]');

      if (!figure) {
        return;
      }

      const page = Number(figure.dataset.pdfPage);

      if (Number.isInteger(page) && page >= 1) {
        togglePage(page);
      }
    };

    const onPageKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      const figure = event.target.closest<HTMLElement>('[data-pdf-page]');

      if (!figure) {
        return;
      }

      const page = Number(figure.dataset.pdfPage);

      if (Number.isInteger(page) && page >= 1) {
        event.preventDefault();
        togglePage(page);
      }
    };

    window.addEventListener('message', onMessage);
    pdfPages?.addEventListener('click', onPageClick);
    pdfPages?.addEventListener('keydown', onPageKeyDown);
    onCleanup(() => {
      window.removeEventListener('message', onMessage);
      pdfPages?.removeEventListener('click', onPageClick);
      pdfPages?.removeEventListener('keydown', onPageKeyDown);
    });
  });

  onCleanup(() => {
    previewController?.abort();
    void renderController?.dispose();
  });

  async function startPreview(
    payload: Extract<RotatePdfHostToWebview, { type: 'init' }>['payload'],
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
        page: {
          label: currentLabels.preview.ariaLabel,
          onCreated: (pageFrame, pageNumber) => {
            pageFrame.setAttribute('role', 'checkbox');
            pageFrame.setAttribute('tabindex', '0');
            pageFrame.setAttribute('aria-checked', String(selectedPages().has(pageNumber)));
            pageFrame.setAttribute('aria-label', `${currentLabels.rotation.pageToggle} ${pageNumber}`);
          },
        },
        signal: controller.signal,
        onRenderError: (error) => {
          if (controller.signal.aborted) {
            return;
          }
          vscode.sendMessage({
            type: 'previewLoadFailed',
            payload: { message: error instanceof Error ? error.message : String(error) },
          });
        },
      });

      await renderController.firstPageReady;

      if (generation !== previewGeneration || controller.signal.aborted) {
        return;
      }

      setPreviewReady(true);
      syncSelectionClasses();
    } catch (error) {
      if (controller.signal.aborted || generation !== previewGeneration) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
      setApplyError(currentLabels.preview.renderError);
    }
  }

  function togglePage(page: number): void {
    const next = new Set(selectedPages());
    if (next.has(page)) {
      next.delete(page);
    } else {
      next.add(page);
    }
    setSelectedPages(next);
  }

  function toggleSelectAll(): void {
    const count = pageCount();
    const next = new Set(selectedPages());
    if (next.size < count) {
      for (let page = 1; page <= count; page += 1) {
        next.add(page);
      }
    } else {
      next.clear();
    }
    setSelectedPages(next);
  }

  function syncSelectionClasses(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    for (const figure of container.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
      const page = Number(figure.dataset.pdfPage);
      const selected = selectedPages().has(page);
      figure.classList.toggle('pdf-page--selected', selected);
      figure.setAttribute('aria-checked', String(selected));
    }
  }

  function apply(): void {
    const selection = selectedPages();
    if (selection.size === 0) {
      setApplyError(labels().validation.pagesRequired);
      return;
    }
    setApplyError('');
    const pageIndices = [...selection].sort((left, right) => left - right);
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
            {labels().preview.description} {selectedPages().size}/{pageCount()}
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
