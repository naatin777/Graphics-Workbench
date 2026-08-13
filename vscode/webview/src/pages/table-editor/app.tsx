import { createMemo, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';

import { tableEditorProtocol, type TableEditorFormat } from '@graphics-workbench/vscode-protocol/table-editor-protocol';
import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';
import {
  addTableColumn,
  addTableRow,
  createTableModel,
  isTsvTableCandidate,
  parseCsv,
  parseTsv,
  removeTableColumn,
  removeTableRow,
  renderLatexTable,
  renderQuarkdownTable,
  renderTypstTable,
  setColumnAlignment,
  setHeaderRows,
  tableModelFromRows,
  updateCellText,
  type TableAlignment,
  type TableModel,
} from '@graphics-workbench/core/table';
import { createMessageReader, type MessageReader } from '@webview-shared/messages';
import { Button } from '@webview-shared/ui/Button';
import { createPageProtocolClient, type WebviewHost } from '@webview-shared/vscode';

const INITIAL_ROW_COUNT = 2;
const INITIAL_COLUMN_COUNT = 3;

const ALIGNMENTS: Readonly<Record<string, TableAlignment | undefined>> = {
  left: 'left',
  center: 'center',
  right: 'right',
};

const FORMATS: Readonly<Record<string, TableEditorFormat | undefined>> = {
  latex: 'latex',
  typst: 'typst',
  quarkdown: 'quarkdown',
};

function parseAlignment(value: string): TableAlignment {
  return ALIGNMENTS[value] ?? 'left';
}

function parseFormat(value: string): TableEditorFormat {
  return FORMATS[value] ?? 'latex';
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = 'copy';
  }
}

export function App(properties: { host: WebviewHost }): JSX.Element {
  const channel = createPageProtocolClient(tableEditorProtocol, properties.host);
  const [labelsCatalog, setLabelsCatalog] = createSignal<MessageCatalog>({});
  const t = createMemo(() => createMessageReader(labelsCatalog()));
  const currentLabels = (): MessageReader | undefined => (Object.keys(labelsCatalog()).length > 0 ? t() : undefined);
  const [model, setModel] = createSignal<TableModel>(createTableModel(INITIAL_ROW_COUNT, INITIAL_COLUMN_COUNT, 1));
  const [format, setFormat] = createSignal<TableEditorFormat>('latex');
  const [booktabs, setBooktabs] = createSignal(true);
  const [status, setStatus] = createSignal<string>();
  const [hostError, setHostError] = createSignal<string>();

  const preview = createMemo(() => {
    const table = model();
    if (format() === 'typst') {
      return renderTypstTable(table);
    }
    if (format() === 'quarkdown') {
      return renderQuarkdownTable(table);
    }
    return renderLatexTable(table, { booktabs: booktabs() });
  });

  function handleCellInput(rowIndex: number, columnIndex: number, value: string): void {
    setModel((current) => updateCellText(current, rowIndex, columnIndex, value));
  }

  function handleAddRow(): void {
    setModel((current) => addTableRow(current));
  }

  function handleRemoveRow(rowIndex: number): void {
    setModel((current) => removeTableRow(current, rowIndex));
  }

  function handleAddColumn(): void {
    setModel((current) => addTableColumn(current));
  }

  function handleRemoveColumn(columnIndex: number): void {
    setModel((current) => removeTableColumn(current, columnIndex));
  }

  function handleAlignmentChange(columnIndex: number, alignment: TableAlignment): void {
    setModel((current) => setColumnAlignment(current, columnIndex, alignment));
  }

  function handleHeaderToggle(enabled: boolean): void {
    setModel((current) => setHeaderRows(current, enabled ? 1 : 0));
  }

  function handlePaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain');
    if (text === undefined || text.length === 0 || !isTsvTableCandidate(text)) {
      return;
    }
    event.preventDefault();
    loadRows(parseTsv(text));
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files.item(0);
    if (file === undefined || file === null) {
      return;
    }
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.csv')) {
      loadRows(parseCsv(await file.text()));
    } else if (fileName.endsWith('.tsv')) {
      loadRows(parseTsv(await file.text()));
    } else {
      setStatus(currentLabels()?.('webview.tableEditor.input.unsupportedFile'));
    }
  }

  function loadRows(rows: string[][]): void {
    if (rows.length === 0) {
      setStatus(currentLabels()?.('webview.tableEditor.input.emptyFile'));
      return;
    }
    setModel((current) => tableModelFromRows(rows, current.headerRows));
    setStatus(undefined);
  }

  function handleInsert(): void {
    channel.send.insert({ format: format(), code: preview() });
  }

  onMount(() => {
    const unsubscribeMessages = channel.on({
      error: ({ message }) => {
        setHostError(message);
      },
      init: ({ labels: initialCatalog, format: initialFormat }) => {
        setLabelsCatalog(initialCatalog);
        setFormat(initialFormat);
        setModel(createTableModel(INITIAL_ROW_COUNT, INITIAL_COLUMN_COUNT, 1));
        setHostError(undefined);
      },
    });
    const onDrop = (event: DragEvent): void => {
      void handleDrop(event);
    };
    globalThis.addEventListener('paste', handlePaste);
    globalThis.addEventListener('dragover', handleDragOver);
    globalThis.addEventListener('drop', onDrop);
    channel.send.ready();
    onCleanup(() => {
      unsubscribeMessages();
      globalThis.removeEventListener('paste', handlePaste);
      globalThis.removeEventListener('dragover', handleDragOver);
      globalThis.removeEventListener('drop', onDrop);
    });
  });

  return (
    <Show when={Object.keys(labelsCatalog()).length > 0}>
      <div class='table-editor'>
        <header class='table-editor__header'>
          <h1>{t()('webview.tableEditor.header.title')}</h1>
          <p>{t()('webview.tableEditor.header.description')}</p>
        </header>

        <Show when={hostError() !== undefined || status() !== undefined}>
          <div
            class='table-editor__status'
            role='alert'
          >
            {hostError() ?? status()}
          </div>
        </Show>

        <section class='table-editor__section'>
          <div class='table-editor__tools'>
            <Button
              variant='secondary'
              small
              onClick={handleAddRow}
            >
              <span
                class='codicon codicon-add'
                aria-hidden='true'
              />
              {t()('webview.tableEditor.table.addRow')}
            </Button>
            <Button
              variant='secondary'
              small
              onClick={handleAddColumn}
            >
              <span
                class='codicon codicon-add'
                aria-hidden='true'
              />
              {t()('webview.tableEditor.table.addColumn')}
            </Button>
          </div>

          <div class='table-editor__grid-scroll'>
            <table class='table-editor__grid'>
              <thead>
                <tr>
                  <th class='table-editor__row-handle' />
                  {model().columns.map((column, columnIndex) => (
                    <th class='table-editor__column-tool'>
                      <select
                        class='gw-select'
                        value={column.alignment}
                        aria-label={`${t()('webview.tableEditor.table.alignmentLabel')} ${columnIndex + 1}`}
                        onInput={(event) => {
                          handleAlignmentChange(columnIndex, parseAlignment(event.currentTarget.value));
                        }}
                      >
                        <option value='left'>{t()('webview.tableEditor.table.alignmentLeft')}</option>
                        <option value='center'>{t()('webview.tableEditor.table.alignmentCenter')}</option>
                        <option value='right'>{t()('webview.tableEditor.table.alignmentRight')}</option>
                      </select>
                      <button
                        class='gw-toolbar-button'
                        type='button'
                        aria-label={`${t()('webview.tableEditor.table.removeColumn')} ${columnIndex + 1}`}
                        disabled={model().columns.length <= 1}
                        onClick={() => {
                          handleRemoveColumn(columnIndex);
                        }}
                      >
                        <span
                          class='codicon codicon-close'
                          aria-hidden='true'
                        />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model().rows.map((row, rowIndex) => (
                  <tr
                    classList={{
                      'table-editor__row--header': rowIndex < model().headerRows,
                    }}
                  >
                    <td class='table-editor__row-handle'>
                      <button
                        class='gw-toolbar-button'
                        type='button'
                        aria-label={`${t()('webview.tableEditor.table.removeRow')} ${rowIndex + 1}`}
                        disabled={model().rows.length <= 1}
                        onClick={() => {
                          handleRemoveRow(rowIndex);
                        }}
                      >
                        <span
                          class='codicon codicon-close'
                          aria-hidden='true'
                        />
                      </button>
                    </td>
                    {row.cells.map((cell, columnIndex) => (
                      <td class='table-editor__cell'>
                        <input
                          class='gw-input'
                          type='text'
                          value={cell.text}
                          onInput={(event) => {
                            handleCellInput(rowIndex, columnIndex, event.currentTarget.value);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section class='table-editor__section table-editor__options'>
          <label class='field'>
            <span class='field__label'>{t()('webview.tableEditor.options.formatLabel')}</span>
            <select
              class='gw-select'
              value={format()}
              onInput={(event) => {
                setFormat(parseFormat(event.currentTarget.value));
              }}
            >
              <option value='latex'>{t()('webview.tableEditor.options.formatLatex')}</option>
              <option value='typst'>{t()('webview.tableEditor.options.formatTypst')}</option>
              <option value='quarkdown'>{t()('webview.tableEditor.options.formatQuarkdown')}</option>
            </select>
          </label>
          <label class='table-editor__toggle'>
            <input
              type='checkbox'
              checked={model().headerRows > 0}
              onInput={(event) => {
                handleHeaderToggle(event.currentTarget.checked);
              }}
            />
            {t()('webview.tableEditor.table.headerToggle')}
          </label>
          <Show when={format() === 'latex'}>
            <label class='table-editor__toggle'>
              <input
                type='checkbox'
                checked={booktabs()}
                onInput={(event) => {
                  setBooktabs(event.currentTarget.checked);
                }}
              />
              {t()('webview.tableEditor.options.booktabs')}
            </label>
          </Show>
        </section>

        <section class='table-editor__section table-editor__preview'>
          <h2 class='table-editor__preview-title'>{t()('webview.tableEditor.preview.title')}</h2>
          <pre class='table-editor__code'>{preview()}</pre>
        </section>

        <footer class='gw-actions'>
          <Button
            variant='primary'
            onClick={handleInsert}
          >
            {t()('webview.tableEditor.actions.insert')}
          </Button>
        </footer>
      </div>
    </Show>
  );
}
