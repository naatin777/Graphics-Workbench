import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';

import { parsePdfPageSelection } from '@graphics-workbench/core/formats';

import { splitPdfProtocol, type SplitPdfPageGroupRow } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

import { Button } from '../../shared/ui/Button';
import { PageNavigator } from '../../shared/ui/PageNavigator';

import { GroupRow } from './GroupRow';
import { formatLabel, formatPageParseFailure } from './page_validation_messages';
import { readSplitPdfLabels, type SplitPdfLabels } from './labels';
import { applyPreviewZoom, capturePreviewZoomAnchor, restorePreviewZoomAnchor } from '@webview-shared/pdf/preview_zoom';
import { createPdfPreview, useCurrentPage } from '@webview-shared/pdf/create_pdf_preview';
import { PreviewToolbar } from './preview_toolbar';
import { SplitPane } from '@webview-shared/SplitPane';
import type { InputKind, PreviewMode, Row } from './types';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

type RowRefs = Partial<Record<InputKind, HTMLInputElement>>;

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(splitPdfProtocol, properties.host);
  let nextRowId = 1;
  const createRow = (): Row => ({
    id: nextRowId++,
    pages: '',
    outputName: '',
    outputNameEdited: false,
  });

  const [rows, setRows] = createStore<Row[]>([createRow()]);
  const [labelsCatalog, setLabelsCatalog] = createSignal<MessageCatalog>({});
  const labels = (): SplitPdfLabels => readSplitPdfLabels(labelsCatalog());
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [outputPathTemplate, setOutputPathTemplate] = createSignal('');
  const [focusedRowId, setFocusedRowId] = createSignal(1);
  const [previewMode, setPreviewMode] = createSignal<PreviewMode>('focused');
  const [zoomPercent, setZoomPercent] = createSignal(100);
  const [applyError, setApplyError] = createSignal('');
  const [renderError, setRenderError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);

  const cancel = (): void => {
    channel.send.cancel();
  };

  const rowRefs = new Map<number, RowRefs>();
  let pdfPreview: HTMLElement | undefined;
  let pdfPages: HTMLDivElement | undefined;
  let draggedRowId: number | undefined;

  const preview = createPdfPreview({
    pagesContainer: () => pdfPages,
    scrollContainer: () => pdfPreview,
    pageCount,
    setRenderError,
    onRenderError: (message) => {
      setPreviewReady(false);
      channel.send.previewLoadFailed({ message });
    },
  });
  const currentPage = useCurrentPage(preview);

  const setInputRef = (rowId: number, kind: InputKind, element: HTMLInputElement): void => {
    const refs = rowRefs.get(rowId) ?? {};
    refs[kind] = element;
    rowRefs.set(rowId, refs);
  };

  const focusInput = (rowId: number, kind: InputKind): void => {
    setFocusedRowId(rowId);
    queueMicrotask(() => rowRefs.get(rowId)?.[kind]?.focus());
  };

  const addRow = (): number => {
    const row = createRow();
    setRows(rows.length, row);
    setFocusedRowId(row.id);
    setApplyError('');
    return row.id;
  };

  const updatePages = (rowId: number, pages: string): void => {
    const rowIndex = rows.findIndex((row) => row.id === rowId);
    const row = rows[rowIndex];

    if (rowIndex < 0 || !row) {
      return;
    }

    setRows(rowIndex, {
      pages,
      ...(row.outputNameEdited ? {} : { outputName: pages }),
    });
    setApplyError('');
  };

  const updateOutputName = (rowId: number, outputName: string): void => {
    const rowIndex = rows.findIndex((row) => row.id === rowId);

    if (rowIndex < 0) {
      return;
    }

    setRows(rowIndex, { outputName, outputNameEdited: true });
    setApplyError('');
  };

  const removeRow = (rowId: number): void => {
    const current = rows;
    const index = current.findIndex((row) => row.id === rowId);

    if (index < 0) {
      return;
    }

    if (current.length === 1) {
      const replacement = createRow();
      setRows([replacement]);
      setFocusedRowId(replacement.id);
      focusInput(replacement.id, 'pages');
      setApplyError('');
      return;
    }

    setRows((currentRows) => currentRows.filter((row) => row.id !== rowId));

    const nextRows = current.filter((row) => row.id !== rowId);

    if (focusedRowId() === rowId) {
      const nextFocusedRow = nextRows[Math.min(index, nextRows.length - 1)];

      if (nextFocusedRow) {
        focusInput(nextFocusedRow.id, 'pages');
      }
    }

    setApplyError('');
  };

  const moveRow = (rowId: number, direction: -1 | 1): void => {
    const current = rows;
    const index = current.findIndex((row) => row.id === rowId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
      return;
    }

    const nextRows = [...current];
    const row = nextRows[index];
    const target = nextRows[nextIndex];

    if (!row || !target) {
      return;
    }

    nextRows[index] = target;
    nextRows[nextIndex] = row;
    setRows(nextRows);
  };

  const handleRowKeyDown = (event: KeyboardEvent, rowIndex: number, kind: InputKind): void => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    const current = rows;
    const row = current[rowIndex];

    if (!row) {
      return;
    }

    const parsedPages = parsePdfPageSelection(row.pages, pageCount());

    if (!parsedPages.ok) {
      setApplyError(`${labels().groups.label} ${rowIndex + 1}: ${formatPageParseFailure(parsedPages, labels())}`);
      return;
    }

    if (row.outputName.trim().length === 0) {
      setApplyError(`${labels().groups.label} ${rowIndex + 1}: ${labels().validation.outputNameEmpty}`);
      return;
    }

    const nextRow = current[rowIndex + 1];

    if (!nextRow) {
      const newRowId = addRow();
      focusInput(newRowId, 'pages');
      return;
    }

    focusInput(nextRow.id, kind);
  };

  const dropRow = (event: DragEvent, targetRowId: number): void => {
    event.preventDefault();
    const sourceRowId = draggedRowId ?? Number(event.dataTransfer?.getData('text/plain'));

    if (!Number.isInteger(sourceRowId) || sourceRowId === targetRowId) {
      draggedRowId = undefined;
      return;
    }

    const current = rows;
    const sourceIndex = current.findIndex((row) => row.id === sourceRowId);
    const targetIndex = current.findIndex((row) => row.id === targetRowId);

    if (sourceIndex < 0 || targetIndex < 0) {
      draggedRowId = undefined;
      return;
    }

    const nextRows = [...current];
    const [source] = nextRows.splice(sourceIndex, 1);

    if (source) {
      nextRows.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, source);
      setRows(nextRows);
    }

    draggedRowId = undefined;
  };

  const validateRows = (): { rows: SplitPdfPageGroupRow[] } | { rowId: number; message: string } => {
    const outputNames = new Set<string>();
    const configuredRows: SplitPdfPageGroupRow[] = [];

    for (const [index, row] of rows.entries()) {
      const parsedPages = parsePdfPageSelection(row.pages, pageCount());

      if (!parsedPages.ok) {
        return {
          rowId: row.id,
          message: `${labels().groups.label} ${index + 1}: ${formatPageParseFailure(parsedPages, labels())}`,
        };
      }

      if (row.outputName.trim().length === 0) {
        return {
          rowId: row.id,
          message: `${labels().groups.label} ${index + 1}: ${labels().validation.outputNameEmpty}`,
        };
      }

      if (row.outputName.includes('\u0000') || /[\\/]/.test(row.outputName) || row.outputName.includes('..')) {
        return {
          rowId: row.id,
          message: `${labels().groups.label} ${index + 1}: ${labels().validation.outputNamePath}`,
        };
      }

      if (outputNames.has(row.outputName)) {
        return {
          rowId: row.id,
          message: formatLabel(labels().validation.outputNameDuplicate, row.outputName),
        };
      }

      outputNames.add(row.outputName);
      configuredRows.push({ pages: parsedPages.pages, outputName: row.outputName });
    }

    return { rows: configuredRows };
  };

  const apply = (): void => {
    if (!previewReady() || renderError()) {
      setApplyError(labels().preview.applyError);
      return;
    }

    const result = validateRows();

    if ('message' in result) {
      setApplyError(result.message);
      focusInput(result.rowId, 'pages');
      return;
    }

    setApplyError('');
    channel.send.apply({ rows: result.rows });
  };

  const updatePreviewVisibility = (): void => {
    if (!pdfPages) {
      return;
    }

    const focusedRow = rows.find((row) => row.id === focusedRowId());
    const parsedPages = focusedRow ? parsePdfPageSelection(focusedRow.pages, pageCount()) : undefined;
    const focusedPages = new Set(parsedPages?.ok === true ? parsedPages.pages : []);

    for (const frame of pdfPages.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
      const pageNumber = Number(frame.dataset.pdfPage);
      const isFocused = focusedPages.has(pageNumber);
      frame.hidden = previewMode() === 'focused' && !isFocused;
      frame.classList.toggle('pdf-page--focused', previewMode() === 'all' && isFocused);
    }
  };

  const normalizeZoom = (value: number): number => {
    if (!Number.isFinite(value)) {
      return zoomPercent();
    }

    return Math.min(400, Math.max(25, Math.round(value / 5) * 5));
  };

  const updateZoom = (value: number, target?: EventTarget | null, clientX?: number, clientY?: number): void => {
    const nextZoom = normalizeZoom(value);

    if (nextZoom === zoomPercent()) {
      return;
    }

    const anchor = capturePreviewZoomAnchor(pdfPreview, target, clientX, clientY);
    setZoomPercent(nextZoom);
    applyPreviewZoom(pdfPages, nextZoom / 100);
    restorePreviewZoomAnchor(pdfPreview, anchor);
    requestAnimationFrame(() => {
      preview.recomputeCurrentPage();
    });
  };

  const zoomWithWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    updateZoom(zoomPercent() + (event.deltaY < 0 ? 5 : -5), event.target, event.clientX, event.clientY);
  };

  createEffect(() => {
    focusedRowId();
    pageCount();
    previewMode();
    updatePreviewVisibility();
    requestAnimationFrame(() => {
      preview.recomputeCurrentPage();
    });
  });

  onMount(() => {
    const unsubscribeMessages = channel.on({
      error: ({ message }) => {
        setApplyError(message);
      },
      init: (payload) => {
        const firstRow = createRow();
        setLabelsCatalog(payload.labels);
        setFileName(payload.fileName);
        setPageCount(payload.pageCount);
        setOutputPathTemplate(payload.outputPathTemplate);
        setRows([firstRow]);
        setFocusedRowId(firstRow.id);
        setPreviewMode('focused');
        setZoomPercent(100);
        setApplyError('');
        setRenderError('');
        setPreviewReady(false);
        void preview.start(
          payload.pdfSrc,
          {
            preview: payload.preview,
            resources: payload.resources,
            ...(pdfPreview === undefined ? {} : { root: pdfPreview }),
            page: { label: labels().pages.label },
          },
          () => {
            setPreviewReady(true);
            applyPreviewZoom(pdfPages, zoomPercent() / 100);
            updatePreviewVisibility();
          },
        );
      },
    });

    channel.send.ready();

    onCleanup(() => {
      unsubscribeMessages();
    });
  });

  return (
    <Show when={Object.keys(labelsCatalog()).length > 0}>
      {(_labels) => (
        <main class='app'>
          <h1 class='sr-only'>{labels().header.title}</h1>
          <p class='sr-only'>
            {fileName()} | {pageCount()} {labels().pages.title}. {labels().header.description}
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
                  classList={{ 'pdf-preview--fit': zoomPercent() <= 100 }}
                  onWheel={zoomWithWheel}
                >
                  <PreviewToolbar
                    labels={labels()}
                    previewMode={previewMode()}
                    zoomPercent={zoomPercent()}
                    onPreviewModeChange={(value) => {
                      setPreviewMode(value);
                    }}
                    onZoomChange={(value) => {
                      updateZoom(value);
                    }}
                  />
                  <div
                    ref={(element) => {
                      pdfPages = element;
                    }}
                    class='pdf-preview__pages'
                  />
                  <Show when={renderError()}>
                    <p
                      class='pdf-preview__error'
                      role='status'
                    >
                      {labels().preview.renderError}: {renderError()}
                    </p>
                  </Show>
                  <PageNavigator
                    currentPage={currentPage() ?? 0}
                    pageCount={pageCount()}
                    onPrevious={preview.goToPreviousPage}
                    onNext={preview.goToNextPage}
                  />
                </section>
              }
              right={
                <section
                  aria-label={labels().groups.title}
                  class='panel'
                >
                  <div class='panel__heading'>
                    <div>
                      <h2>{labels().groups.title}</h2>
                      <p>{labels().groups.outputOrder}</p>
                    </div>
                    <button
                      class='gw-button gw-button--secondary'
                      type='button'
                      onClick={() => {
                        const rowId = addRow();
                        focusInput(rowId, 'pages');
                      }}
                    >
                      {labels().groups.add}
                    </button>
                  </div>

                  <div class='rows'>
                    <For each={rows}>
                      {(row, index) => (
                        <GroupRow
                          row={row}
                          index={index}
                          rowCount={rows.length}
                          labels={labels()}
                          outputPathTemplate={outputPathTemplate()}
                          focused={focusedRowId() === row.id}
                          handlers={{
                            fields: {
                              setInputRef,
                              onFocus: (rowId) => {
                                setFocusedRowId(rowId);
                              },
                              onPagesChange: updatePages,
                              onOutputNameChange: updateOutputName,
                              onKeyDown: handleRowKeyDown,
                            },
                            row: {
                              onMove: moveRow,
                              onRemove: removeRow,
                            },
                            drag: {
                              onDragStart: (event, rowId) => {
                                draggedRowId = rowId;
                                if (event.dataTransfer) {
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', rowId.toString());
                                }
                              },
                              onDragEnd: () => (draggedRowId = undefined),
                              onDragOver: (event) => {
                                event.preventDefault();
                              },
                              onDrop: dropRow,
                            },
                          }}
                        />
                      )}
                    </For>
                  </div>

                  <Show when={applyError()}>
                    <p
                      class='panel__error'
                      role='alert'
                    >
                      {applyError()}
                    </p>
                  </Show>

                  <div class='actions gw-actions'>
                    <Button
                      variant='primary'
                      disabled={((): boolean => {
                        const result = validateRows();
                        return 'message' in result;
                      })()}
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
        </main>
      )}
    </Show>
  );
}
