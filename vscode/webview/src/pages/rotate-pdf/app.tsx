import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';

import {
  PDF_ROTATION_ANGLES,
  rotatePdfProtocol,
  type PdfRotationAngle,
  type RotatePdfHostToWebview,
  type RotatePdfLabels,
} from '@graphics-workbench/vscode-protocol/rotate-pdf-protocol';
import { renderPdfPages, type PdfRenderController } from '@webview-shared/pdf/render_pdf_pages';
import { toErrorMessage } from '@webview-shared/error';
import { SplitPane } from '@webview-shared/SplitPane';
import { Button } from '@webview-shared/ui/Button';
import { PageNavigator, scrollPageIntoView } from '@webview-shared/ui/PageNavigator';
import { useCurrentPage } from '@webview-shared/ui/use_current_page';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(rotatePdfProtocol, properties.host);
  const [labelsValue, setLabels] = createSignal<RotatePdfLabels>();
  const labels = (): RotatePdfLabels => {
    const value = labelsValue();
    if (value === undefined) {
      throw new Error('Rotate PDF labels were not initialized.');
    }
    return value;
  };
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

  const { currentPage, recompute } = useCurrentPage({
    scrollContainer: () => pdfPages,
    getPageElements: () =>
      pdfPages === undefined ? [] : [...pdfPages.querySelectorAll<HTMLElement>('.pdf-page[data-pdf-page]')],
  });

  const cancel = (): void => {
    channel.send.cancel();
  };

  createEffect(() => {
    selectedPages();
    syncSelectionClasses();
  });

  createEffect(() => {
    currentPage();
    syncCurrentPageOutline();
  });

  onMount(() => {
    const unsubscribeMessages = channel.on({
      error: ({ message }) => {
        setApplyError(message);
      },
      init: (payload) => {
        setLabels(payload.labels);
        setFileName(payload.fileName);
        setPageCount(payload.pageCount);
        setApplyError('');
        setPreviewReady(false);
        setSelectedPages(new Set<number>());
        const generation = previewGeneration + 1;
        previewGeneration = generation;
        void startPreview(payload, generation);
      },
    });

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

    globalThis.addEventListener('click', onPageClick);
    globalThis.addEventListener('keydown', onPageKeyDown);
    channel.send.ready();
    onCleanup(() => {
      unsubscribeMessages();
      globalThis.removeEventListener('click', onPageClick);
      globalThis.removeEventListener('keydown', onPageKeyDown);
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
        resources: payload.resources,
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
          channel.send.previewLoadFailed({ message: toErrorMessage(error) });
        },
      });

      await renderController.firstPageReady;

      if (generation !== previewGeneration || controller.signal.aborted) {
        return;
      }

      setPreviewReady(true);
      syncSelectionClasses();
      recompute();
      syncCurrentPageOutline();
    } catch (error) {
      if (controller.signal.aborted || generation !== previewGeneration) {
        return;
      }
      const message = toErrorMessage(error);
      channel.send.previewLoadFailed({ message });
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
    for (const figure of container.querySelectorAll<HTMLElement>('.pdf-page')) {
      const page = Number(figure.dataset.pdfPage);
      const selected = selectedPages().has(page);
      figure.classList.toggle('pdf-page--selected', selected);
      figure.setAttribute('aria-checked', String(selected));
    }
  }

  function syncCurrentPageOutline(): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const current = currentPage();
    for (const figure of container.querySelectorAll<HTMLElement>('.pdf-page')) {
      if (Number(figure.dataset.pdfPage) === current) {
        figure.dataset.current = 'true';
      } else {
        delete figure.dataset.current;
      }
    }
  }

  function scrollToPage(page: number): void {
    const container = pdfPages;
    if (!container) {
      return;
    }
    const figure = container.querySelector<HTMLElement>(`.pdf-page[data-pdf-page="${page}"]`);
    if (figure) {
      scrollPageIntoView(figure);
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
    channel.send.apply({ angle: angle(), pageIndices });
  }

  return (
    <Show when={labelsValue()}>
      {(_labels) => (
        <div class='rotate'>
          <header class='rotate__header'>
            <h1>{labels().header.title}</h1>
            <p class='rotate__description'>{labels().header.description}</p>
            <p class='rotate__file'>{fileName()}</p>
          </header>

          <SplitPane
            left={
              <section
                class='rotate__preview'
                aria-label={labels().preview.ariaLabel}
              >
                <div class='rotate__preview-toolbar'>
                  <span>{labels().preview.title}</span>
                  <button
                    type='button'
                    class='gw-button gw-button--secondary gw-button--small'
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
                <PageNavigator
                  currentPage={currentPage()}
                  pageCount={pageCount()}
                  onPrevious={() => {
                    scrollToPage(currentPage() - 1);
                  }}
                  onNext={() => {
                    scrollToPage(currentPage() + 1);
                  }}
                />
              </section>
            }
            right={
              <section class='rotate__panel'>
                <fieldset class='rotate__angle'>
                  <legend>{labels().rotation.title}</legend>
                  <div
                    class='gw-radio-group'
                    role='radiogroup'
                    aria-label={labels().rotation.angleLabel}
                  >
                    <For each={PDF_ROTATION_ANGLES}>
                      {(value) => (
                        <label class='gw-radio-option'>
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
