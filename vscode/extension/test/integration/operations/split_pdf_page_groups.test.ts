import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../../support/helpers/pdf_document.js';

import { parsePdfPageSelection as parseSplitPdfPages } from '@graphics-workbench/core/formats';
import { splitPdfByPageGroups } from '@graphics-workbench/core/pdf';
import { splitPdfProtocol } from '@graphics-workbench/vscode-protocol/split-pdf-protocol';
import { invalidPreflightInputDirectory } from '../../support/helpers/fixture_paths.js';

const acceptsSplitPdfHostToWebviewMessage = (value: unknown): boolean =>
  splitPdfProtocol.parseHostToWebview(value) !== undefined;
const acceptsSplitPdfWebviewToHostMessage = (value: unknown): boolean =>
  splitPdfProtocol.parseWebviewToHost(value) !== undefined;

suite('PDFページグループ分割', () => {
  test('ページ式"10, 3-5, 3, -2, 7-"を10ページのPDFで解析すると、入力順のまま範囲を展開し重複を保持したページ列を返す', () => {
    assert.deepEqual(parseSplitPdfPages('10, 3-5, 3, -2, 7-', 10), {
      ok: true,
      pages: [10, 3, 4, 5, 3, 1, 2, 7, 8, 9, 10],
    });
  });

  test('空の式やカンマ連続（1,,3）、降順範囲（3-1）、ページ数超過（4）のページ式は解析失敗にする', () => {
    assert.equal(parseSplitPdfPages('1,,3', 3).ok, false);
    assert.equal(parseSplitPdfPages('-', 3).ok, false);
    assert.equal(parseSplitPdfPages('3-1', 3).ok, false);
    assert.equal(parseSplitPdfPages('4', 3).ok, false);
  });

  test('ページグループ[[3,1,3],[2]]を指定すると、group1は3→1→3の順で重複を保持し、group2は2ページ目だけのPDFとして生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');

    await writePdf(sourcePath, [101, 102, 103]);

    await splitPdfByPageGroups({
      inputs: [
        {
          sourcePath,
          workspacePath: workspacePath.path,
          pageGroups: [[3, 1, 3], [2]],
          outputPathForGroup: (groupIndex) => path.join(workspacePath.path, `group-${groupIndex + 1}.pdf`),
        },
      ],
      runtime: {},
      runId: 'run',
    });

    const firstGroup = await PDFDocument.load(await readFile(path.join(workspacePath.path, 'group-1.pdf')));
    const secondGroup = await PDFDocument.load(await readFile(path.join(workspacePath.path, 'group-2.pdf')));

    assert.deepEqual(
      firstGroup.getPages().map((page) => page.getWidth()),
      [103, 101, 103],
    );
    assert.deepEqual(
      secondGroup.getPages().map((page) => page.getWidth()),
      [102],
    );
    await access(
      path.join(workspacePath.path, '.graphics-workbench', 'split-pdf', 'run', '1-source', 'groups', '1.pdf'),
    );
  });

  test('分割処理の事前検証で拒否され、一時領域も分割出力も作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'group.pdf');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'split-pdf', 'run');
    const invalidPdfPath = path.join(invalidPreflightInputDirectory, 'not-a-pdf.pdf');

    await copyFile(invalidPdfPath, sourcePath);

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[1]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
        runId: 'run',
      }),
      /Preflight validation failed|Failed to parse PDF|No PDF header found/,
    );

    await assert.rejects(access(outputPath));
    await assert.rejects(access(stagingRootPath));
  });

  test('ページ数の範囲外グループ（[1,3]）と空グループ（[]）は出力前に拒否して出力PDFを作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-split-groups-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'group.pdf');

    await writePdf(sourcePath, [101, 102]);

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[1, 3]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
      }),
      /out of range/,
    );
    await assert.rejects(access(outputPath));

    await assert.rejects(
      splitPdfByPageGroups({
        inputs: [
          {
            sourcePath,
            workspacePath: workspacePath.path,
            pageGroups: [[]],
            outputPathForGroup: () => outputPath,
          },
        ],
        runtime: {},
      }),
      /cannot be empty/,
    );
  });

  test('split-pdfのメッセージ規約に合うinit/ready/previewLoadFailed/applyメッセージだけを受け入れ、追加キーや不正型を拒否する', () => {
    const labels = {
      'webview.splitPdf.title': 'Split PDF',
      'webview.splitPdf.description': 'Split pages into groups.',
      'webview.splitPdf.preview': 'Preview',
      'webview.splitPdf.previewAriaLabel': 'PDF preview',
      'webview.splitPdf.previewRenderError': 'Could not render the PDF.',
      'webview.splitPdf.previewApplyError': 'Preview must finish before applying.',
      'webview.splitPdf.allPages': 'All pages',
      'webview.splitPdf.focusedPages': 'Focused',
      'webview.splitPdf.zoom': 'Preview zoom',
      'webview.splitPdf.groups': 'Groups',
      'webview.splitPdf.groupLabel': 'Group',
      'webview.splitPdf.addGroup': 'Add group',
      'webview.splitPdf.removeGroup': 'Remove group',
      'webview.splitPdf.dragGroup': 'Drag group',
      'webview.splitPdf.outputOrder': 'Output order',
      'webview.splitPdf.pages': 'Pages',
      'webview.splitPdf.pageLabel': 'Page',
      'webview.splitPdf.pagesPlaceholder': '1, 3-5',
      'webview.splitPdf.outputName': 'Output name',
      'webview.splitPdf.outputNamePlaceholder': 'group-1.pdf',
      'webview.splitPdf.outputPath': 'Output path',
      'webview.splitPdf.pagesRequiredError': 'Pages are required.',
      'webview.splitPdf.pageWholeNumberError': 'Page must be a whole number.',
      'webview.splitPdf.pageOutOfRangeError': 'Page is out of range.',
      'webview.splitPdf.invalidPages': 'Invalid pages: {0}',
      'webview.splitPdf.descendingPages': 'Descending pages: {0}',
      'webview.splitPdf.outputNameEmpty': 'Output name is empty.',
      'webview.splitPdf.outputNamePath': 'Output name contains a path.',
      'webview.splitPdf.outputNameDuplicate': 'Output name is duplicated: {0}',
      'webview.splitPdf.apply': 'Apply',
      'webview.splitPdf.cancel': 'Cancel',
      'webview.splitPdf.moveUp': 'Move up',
      'webview.splitPdf.moveDown': 'Move down',
    };

    assert.equal(
      acceptsSplitPdfHostToWebviewMessage({
        type: 'init',
        payload: {
          sourceId: 'source-1',
          fileName: 'source.pdf',
          pageCount: 3,
          pdfSrc: 'vscode-resource://source.pdf',
          outputPathTemplate: 'source/__GRAPHICS_WORKBENCH_OUTPUT_NAME__.pdf',
          resources: {
            workerSrc: 'vscode-resource://worker.mjs',
            cMapUrl: 'vscode-resource://cmaps/',
            standardFontDataUrl: 'vscode-resource://fonts/',
            wasmUrl: 'vscode-resource://wasm/',
          },
          preview: { maxCanvasPixels: 40000000, maxDevicePixelRatio: 2 },
          labels,
        },
      }),
      true,
    );
    assert.equal(
      acceptsSplitPdfHostToWebviewMessage({
        type: 'init',
        payload: {
          sourceId: 'source-1',
          fileName: 'source.pdf',
          pageCount: 3,
          pdfSrc: 'vscode-resource://source.pdf',
          outputPathTemplate: 'source/__GRAPHICS_WORKBENCH_OUTPUT_NAME__.pdf',
          labels,
          sourcePath: '/not-allowed',
        },
      }),
      false,
    );
    assert.equal(acceptsSplitPdfWebviewToHostMessage({ type: 'ready' }), true);
    assert.equal(acceptsSplitPdfWebviewToHostMessage({ type: 'ready', requestId: 'request-1' }), false);
    assert.equal(acceptsSplitPdfWebviewToHostMessage({ type: 'ready', payload: undefined }), false);
    assert.equal(acceptsSplitPdfWebviewToHostMessage({ type: '' }), false);
    assert.equal(
      acceptsSplitPdfWebviewToHostMessage({
        type: 'previewLoadFailed',
        payload: { message: 'preview failed' },
      }),
      true,
    );
    assert.equal(
      acceptsSplitPdfWebviewToHostMessage({
        type: 'previewLoadFailed',
        payload: { message: 'preview failed', code: 'E_FAIL' },
      }),
      false,
    );
    assert.equal(
      acceptsSplitPdfHostToWebviewMessage({
        type: 'init',
        payload: {
          sourceId: 'source-1',
          fileName: 'source.pdf',
          pageCount: 3,
          pdfSrc: '/workspace/source.pdf',
          outputPathTemplate: 'source/__GRAPHICS_WORKBENCH_OUTPUT_NAME__.pdf',
          labels,
        },
      }),
      false,
    );
    assert.equal(
      acceptsSplitPdfWebviewToHostMessage({
        type: 'apply',
        payload: { rows: [{ pages: [2, 2], outputName: 'group.pdf' }] },
      }),
      true,
    );
    assert.equal(
      acceptsSplitPdfWebviewToHostMessage({
        type: 'apply',
        payload: { rows: [{ pages: [], outputName: 'group.pdf' }] },
      }),
      false,
    );
    assert.equal(
      acceptsSplitPdfWebviewToHostMessage({
        type: 'apply',
        payload: { rows: [{ pages: [1], outputName: 'group.pdf' }], sourcePath: '/not-allowed' },
      }),
      false,
    );
  });
});

async function writePdf(filePath: string, widths: readonly number[]): Promise<void> {
  const document = await PDFDocument.create();

  for (const width of widths) {
    document.addPage([width, 200]);
  }

  await writeFile(filePath, await document.save());
}
