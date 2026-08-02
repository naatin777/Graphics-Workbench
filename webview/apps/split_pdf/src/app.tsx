import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';

import { renderPdfPages, type PdfRenderController } from '@webview-shared/pdf/render_pdf_pages';

import type { SplitPdfPageGroupRow } from '@graphics-workbench-split-pdf-protocol';

import { GroupRow } from './group_row';
import { formatLabel, pageFailureMessage } from './helpers';
import { defaultLabels } from './labels';
import { parsePages } from './pages';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './messages';
import { applyPreviewZoom, capturePreviewZoomAnchor, restorePreviewZoomAnchor } from './preview_zoom';
import { PreviewToolbar } from './preview_toolbar';
import { SplitPane } from '../../../shared/split_pane';
import type { InputKind, PreviewMode, Row } from './types';
import { vscode } from './vscode';

type RowRefs = Partial<Record<InputKind, HTMLInputElement>>;
type InitPayload = Extract<ExtensionToWebviewMessage, { type: 'init' }>['payload'];

function cancel(): void {
  vscode.sendMessage({ type: 'cancel' });
}

export function App(): JSX.Element {
  let nextRowId = 1;
  const createRow = (): Row => ({
    id: nextRowId++,
    pages: '',
    outputName: '',
    outputNameEdited: false,
  });

  const [rows, setRows] = createStore<Row[]>([createRow()]);
  const [labels, setLabels] = createSignal(defaultLabels);
  const [fileName, setFileName] = createSignal('');
  const [pageCount, setPageCount] = createSignal(1);
  const [outputPathTemplate, setOutputPathTemplate] = createSignal('');
  const [focusedRowId, setFocusedRowId] = createSignal(1);
  const [previewMode, setPreviewMode] = createSignal<PreviewMode>('focused');
  const [zoomPercent, setZoomPercent] = createSignal(100);
  const [applyError, setApplyError] = createSignal('');
  const [renderError, setRenderError] = createSignal('');
  const [previewReady, setPreviewReady] = createSignal(false);
  const [focusedPagesLabel, setFocusedPagesLabel] = createSignal('');

  const rowRefs = new Map<number, RowRefs>();
  let pdfPreview: HTMLElement | undefined;
  let pdfPages: HTMLDivElement | undefined;
  let renderController: PdfRenderController | undefined;
  let draggedRowId: number | undefined;
  let previewGeneration = 0;

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

    const parsedPages = parsePages(row.pages, pageCount());

    if (!parsedPages.ok) {
      setApplyError(`${labels().groups.label} ${rowIndex + 1}: ${pageFailureMessage(parsedPages, labels())}`);
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
      const parsedPages = parsePages(row.pages, pageCount());

      if (!parsedPages.ok) {
        return {
          rowId: row.id,
          message: `${labels().groups.label} ${index + 1}: ${pageFailureMessage(parsedPages, labels())}`,
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
    const message: WebviewToExtensionMessage = {
      type: 'apply',
      payload: { rows: result.rows },
    };
    vscode.sendMessage(message);
  };

  const updatePreviewVisibility = (): void => {
    if (!pdfPages) {
      return;
    }

    const focusedRow = rows.find((row) => row.id === focusedRowId());
    const parsedPages = focusedRow ? parsePages(focusedRow.pages, pageCount()) : undefined;
    const focusedPages = new Set(parsedPages?.ok === true ? parsedPages.pages : []);
    setFocusedPagesLabel(parsedPages?.ok === true ? parsedPages.pages.join(', ') : '');

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
  };

  const zoomWithWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    updateZoom(zoomPercent() + (event.deltaY < 0 ? 5 : -5), event.target, event.clientX, event.clientY);
  };

  const startPreview = async (payload: InitPayload, generation: number): Promise<void> => {
    if (!pdfPages) {
      return;
    }

    try {
      const controller = await renderPdfPages(payload.pdfSrc, pdfPages, {
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
        ...(pdfPreview === undefined ? {} : { root: pdfPreview }),
        pageLabel: labels().pages.label,
        onRenderError: (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setRenderError(message);
          setPreviewReady(false);
          vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
        },
      });

      if (generation !== previewGeneration) {
        await controller.dispose();
        return;
      }

      renderController = controller;
      await controller.firstPageReady;
      setPreviewReady(true);
      applyPreviewZoom(pdfPages, zoomPercent() / 100);
      updatePreviewVisibility();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setRenderError(message);
      setPreviewReady(false);
      vscode.sendMessage({ type: 'previewLoadFailed', payload: { message } });
    }
  };

  createEffect(() => {
    focusedRowId();
    pageCount();
    previewMode();
    updatePreviewVisibility();
  });

  onMount(() => {
    const handleMessage = (event: MessageEvent<ExtensionToWebviewMessage>): void => {
      if (event.data.type === 'error') {
        setApplyError(event.data.payload.message);
        return;
      }

      const nextLabels = { ...defaultLabels, ...event.data.payload.labels };
      const firstRow = createRow();
      setLabels(nextLabels);
      setFileName(event.data.payload.fileName);
      setPageCount(event.data.payload.pageCount);
      setOutputPathTemplate(event.data.payload.outputPathTemplate);
      setRows([firstRow]);
      setFocusedRowId(firstRow.id);
      setPreviewMode('focused');
      setZoomPercent(100);
      setApplyError('');
      setRenderError('');
      setPreviewReady(false);
      previewGeneration += 1;
      void renderController?.dispose();
      renderController = undefined;
      void startPreview(event.data.payload, previewGeneration);
    };

    window.addEventListener('message', handleMessage);
    vscode.sendMessage({ type: 'ready' });

    onCleanup(() => {
      window.removeEventListener('message', handleMessage);
      previewGeneration += 1;
      void renderController?.dispose();
    });
  });

  return (
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
              <footer class='pdf-preview__footer'>
                {labels().pages.title}: {focusedPagesLabel() || '—'}
              </footer>
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
                  class='button'
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

              <div class='actions'>
                <button
                  class='button button--primary'
                  type='button'
                  disabled={((): boolean => {
                    const result = validateRows();
                    return 'message' in result;
                  })()}
                  onClick={apply}
                >
                  {labels().actions.apply}
                </button>
                <button
                  class='button'
                  type='button'
                  onClick={cancel}
                >
                  {labels().actions.cancel}
                </button>
              </div>
            </section>
          }
        />
      </div>
    </main>
  );
}
