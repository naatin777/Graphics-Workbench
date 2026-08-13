import { render } from 'solid-js/web';

import { createTestPageHost } from '../../test_support/mock_page_host';
import {
  isTableEditorHostToWebviewMessage,
  tableEditorProtocol,
  type TableEditorLabels,
} from '@graphics-workbench-table-editor-protocol';

import { App } from './app';

const sendMessage = vi.hoisted(() => vi.fn<(message: unknown) => void>());

vi.mock('./vscode', () => ({
  vscode: createTestPageHost(tableEditorProtocol, sendMessage),
}));

const labels: TableEditorLabels = {
  header: {
    title: 'Table Editor',
    description: 'Paste a table copied from Excel or Google Sheets, or drop a .csv or .tsv file.',
  },
  input: {
    unsupportedFile: 'Unsupported file. Drop a .csv or .tsv file.',
    emptyFile: 'The file contains no table data.',
  },
  table: {
    addRow: 'Add row',
    addColumn: 'Add column',
    removeRow: 'Remove row',
    removeColumn: 'Remove column',
    alignmentLabel: 'Column alignment',
    alignmentLeft: 'Left',
    alignmentCenter: 'Center',
    alignmentRight: 'Right',
    headerToggle: 'First row is a header',
  },
  options: {
    formatLabel: 'Output format',
    formatLatex: 'LaTeX',
    formatTypst: 'Typst',
    formatQuarkdown: 'Quarkdown',
    booktabs: 'Use booktabs rules',
  },
  preview: { title: 'Preview' },
  actions: { insert: 'Insert' },
};

const initMessage = {
  type: 'init',
  payload: { format: 'latex', labels },
} as const;

let disposeApp: (() => void) | undefined;

async function mountAndInit(): Promise<void> {
  disposeApp = render(() => <App />, document.querySelector('#root')!);
  globalThis.dispatchEvent(new MessageEvent('message', { data: initMessage }));
  await flushPromises();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function cellValues(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('.table-editor__cell input')].map((input) => input.value);
}

function previewCode(): string {
  return document.querySelector('.table-editor__code')?.textContent ?? '';
}

function pasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  return event;
}

function dropEvent(file: File): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: { item: (index: number) => (index === 0 ? file : null), length: 1 } },
  });
  return event;
}

function formatSelect(): HTMLSelectElement | undefined {
  return [...document.querySelectorAll<HTMLSelectElement>('select')].find((select) =>
    ['latex', 'typst', 'quarkdown'].includes(select.value),
  );
}

function setSelectValue(select: HTMLSelectElement | undefined, value: string): void {
  if (select === undefined) {
    throw new Error('select not found');
  }
  select.value = value;
  select.dispatchEvent(new Event('input', { bubbles: true }));
}

function setCheckboxChecked(input: HTMLInputElement | null | undefined, checked: boolean): void {
  if (input === undefined || input === null) {
    throw new Error('checkbox not found');
  }
  input.checked = checked;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function clickInsert(): void {
  [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === 'Insert')
    ?.click();
}

function setInputValue(input: HTMLInputElement | null | undefined, value: string): void {
  if (input === undefined || input === null) {
    throw new Error('input not found');
  }
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  sendMessage.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(async () => {
  disposeApp?.();
  disposeApp = undefined;
  await flushPromises();
});

test('初期状態はready送信と空テーブルの表示', async () => {
  expect(isTableEditorHostToWebviewMessage(initMessage)).toBe(true);
  await mountAndInit();

  expect(sendMessage).toHaveBeenCalledWith({ type: 'ready' });
  expect(cellValues()).toHaveLength(6);
  expect(cellValues().every((value) => value === '')).toBe(true);
});

test('タブ区切りのTSVを貼り付けるとテーブルとして表示される', async () => {
  await mountAndInit();

  globalThis.dispatchEvent(pasteEvent('Method\tTime\tScore\nA\t12.4\t91.2\nB\t10.8\t94.5'));
  await flushPromises();

  expect(cellValues()).toEqual(['Method', 'Time', 'Score', 'A', '12.4', '91.2', 'B', '10.8', '94.5']);
});

test('タブを含まない文章の貼り付けはテーブルとして認識しない', async () => {
  await mountAndInit();

  globalThis.dispatchEvent(pasteEvent('This is a plain sentence without tabs.'));
  await flushPromises();

  expect(cellValues().every((value) => value === '')).toBe(true);
});

test('セル編集でプレビューが即時更新される', async () => {
  await mountAndInit();
  globalThis.dispatchEvent(pasteEvent('Method\tScore\nA\t91.2'));
  await flushPromises();

  expect(previewCode()).toContain('\\toprule');

  setInputValue(document.querySelector<HTMLInputElement>('.table-editor__cell input'), 'Metric');
  await flushPromises();

  expect(previewCode()).toContain('Metric & Score');
});

test('Insertで現在の形式と生成コードを送信する', async () => {
  await mountAndInit();
  globalThis.dispatchEvent(pasteEvent('Method\tScore\nA\t91.2'));
  await flushPromises();

  clickInsert();

  expect(sendMessage).toHaveBeenCalledWith({
    type: 'insert',
    payload: { format: 'latex', code: previewCode() },
  });
});

test('出力形式の切り替えでプレビューとInsert形式が変わる', async () => {
  await mountAndInit();
  globalThis.dispatchEvent(pasteEvent('Method\tScore\nA\t91.2'));
  await flushPromises();

  setSelectValue(formatSelect(), 'typst');
  await flushPromises();

  expect(previewCode()).toContain('#table(');
  expect(previewCode()).toContain('table.header([*#text("Method")*]');

  sendMessage.mockClear();
  clickInsert();
  expect(sendMessage).toHaveBeenCalledWith({
    type: 'insert',
    payload: { format: 'typst', code: previewCode() },
  });
});

test('CSVファイルのドロップでテーブルを読み込む', async () => {
  await mountAndInit();

  globalThis.dispatchEvent(dropEvent(new File(['a,b\n1,2\n3,4\n'], 'data.csv')));
  await flushPromises();
  await flushPromises();

  expect(cellValues()).toEqual(['a', 'b', '1', '2', '3', '4']);
});

test('TSVファイルのドロップでテーブルを読み込む', async () => {
  await mountAndInit();

  globalThis.dispatchEvent(dropEvent(new File(['x\ty\n1\t2\n'], 'data.tsv')));
  await flushPromises();
  await flushPromises();

  expect(cellValues()).toEqual(['x', 'y', '1', '2']);
});

test('サポート外のファイルのドロップは明示的なエラーを表示してテーブルを変えない', async () => {
  await mountAndInit();

  globalThis.dispatchEvent(dropEvent(new File(['hello'], 'notes.txt')));
  await flushPromises();
  await flushPromises();

  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Unsupported file. Drop a .csv or .tsv file.');
  expect(cellValues().every((value) => value === '')).toBe(true);
});

test('booktabs切り替えはLaTeX形式のときのみ表示される', async () => {
  await mountAndInit();

  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);

  setSelectValue(formatSelect(), 'typst');
  await flushPromises();

  expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
});

test('header切り替えとalignmentがQuarkdown出力へ反映される', async () => {
  await mountAndInit();
  globalThis.dispatchEvent(pasteEvent('Method\tScore\nA\t91.2'));
  await flushPromises();

  setSelectValue(formatSelect(), 'quarkdown');
  await flushPromises();

  expect(previewCode()).toContain('| Method | Score |');
  expect(previewCode()).toContain('| :--- | :--- |');

  const headerToggle = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
  setCheckboxChecked(headerToggle, false);
  await flushPromises();

  expect(previewCode()).toContain('|  |  |');
});
