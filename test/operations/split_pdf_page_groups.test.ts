import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import {
  isSplitPdfHostToWebviewMessage,
  isSplitPdfWebviewToHostMessage,
  parseSplitPdfPages,
  type SplitPdfLabels,
} from '../../src/application/protocols/split_pdf_protocol.js';
import { splitPdfByPageGroups } from '../../src/operations/pdf/split_pdf.js';
import { invalidPreflightInputDirectory } from '../helpers/fixture_paths.js';

suite('PDFページグループ分割', () => {
  test('入力順でページ式を解析し、範囲と重複を処理する', () => {
    assert.deepEqual(parseSplitPdfPages('10, 3-5, 3, -2, 7-', 10), {
      ok: true,
      pages: [10, 3, 4, 5, 3, 1, 2, 7, 8, 9, 10],
    });
  });

  test('不正な形式、降順、範囲外のページ式を拒否する', () => {
    assert.equal(parseSplitPdfPages('1,,3', 3).ok, false);
    assert.equal(parseSplitPdfPages('-', 3).ok, false);
    assert.equal(parseSplitPdfPages('3-1', 3).ok, false);
    assert.equal(parseSplitPdfPages('4', 3).ok, false);
  });

  test('指定順でグループ化PDFを作成し、重複ページを保持する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-split-groups-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');

    try {
      await writePdf(sourcePath, [101, 102, 103]);

      await splitPdfByPageGroups({
        jobs: [
          {
            sourcePath,
            workspacePath,
            pageGroups: [[3, 1, 3], [2]],
            outputPathForGroup: (groupIndex) => path.join(workspacePath, `group-${groupIndex + 1}.pdf`),
          },
        ],
        runId: 'run',
      });

      const firstGroup = await PDFDocument.load(await readFile(path.join(workspacePath, 'group-1.pdf')));
      const secondGroup = await PDFDocument.load(await readFile(path.join(workspacePath, 'group-2.pdf')));

      assert.deepEqual(
        firstGroup.getPages().map((page) => page.getWidth()),
        [103, 101, 103],
      );
      assert.deepEqual(
        secondGroup.getPages().map((page) => page.getWidth()),
        [102],
      );
      await access(path.join(workspacePath, '.graphics-workbench', 'split-pdf', 'run', '1-source', 'groups', '1.pdf'));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('ステージング作成前に不正なPDFを共通preflightで拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-split-groups-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'group.pdf');
    const stagingRootPath = path.join(workspacePath, '.graphics-workbench', 'split-pdf', 'run');
    const invalidPdfPath = path.join(invalidPreflightInputDirectory, 'invalid-header.pdf');

    try {
      await copyFile(invalidPdfPath, sourcePath);

      await assert.rejects(
        splitPdfByPageGroups({
          jobs: [
            {
              sourcePath,
              workspacePath,
              pageGroups: [[1]],
              outputPathForGroup: () => outputPath,
            },
          ],
          runId: 'run',
        }),
        /Preflight validation failed|Failed to parse PDF|No PDF header found/,
      );

      await assert.rejects(access(outputPath));
      await assert.rejects(access(stagingRootPath));
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('空のグループと範囲外のグループをコミット前に拒否する', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-split-groups-test-'));
    const sourcePath = path.join(workspacePath, 'source.pdf');
    const outputPath = path.join(workspacePath, 'group.pdf');

    try {
      await writePdf(sourcePath, [101, 102]);

      await assert.rejects(
        splitPdfByPageGroups({
          jobs: [
            {
              sourcePath,
              workspacePath,
              pageGroups: [[1, 3]],
              outputPathForGroup: () => outputPath,
            },
          ],
        }),
        /out of range/,
      );
      await assert.rejects(access(outputPath));

      await assert.rejects(
        splitPdfByPageGroups({
          jobs: [
            {
              sourcePath,
              workspacePath,
              pageGroups: [[]],
              outputPathForGroup: () => outputPath,
            },
          ],
        }),
        /cannot be empty/,
      );
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  test('定義されたプロトコルの型のみを受け付ける', () => {
    const labels: SplitPdfLabels = {
      header: {
        title: 'Split PDF',
        description: 'Split pages into groups.',
      },
      preview: {
        title: 'Preview',
        description: 'Preview the source PDF.',
        ariaLabel: 'PDF preview',
        renderError: 'Could not render the PDF.',
        applyError: 'Preview must finish before applying.',
        allPages: 'All pages',
        focusedPages: 'Focused',
        zoom: 'Preview zoom',
      },
      groups: {
        title: 'Groups',
        label: 'Group',
        add: 'Add group',
        remove: 'Remove group',
        drag: 'Drag group',
        outputOrder: 'Output order',
      },
      pages: {
        title: 'Pages',
        label: 'Page',
        placeholder: '1, 3-5',
      },
      output: {
        name: 'Output name',
        namePlaceholder: 'group-1.pdf',
        path: 'Output path',
      },
      validation: {
        pagesRequired: 'Pages are required.',
        pageWholeNumber: 'Page must be a whole number.',
        pageOutOfRange: 'Page is out of range.',
        invalidPages: 'Invalid pages: {0}',
        descendingPages: 'Descending pages: {0}',
        outputNameEmpty: 'Output name is empty.',
        outputNamePath: 'Output name contains a path.',
        outputNameDuplicate: 'Output name is duplicated: {0}',
      },
      actions: {
        apply: 'Apply',
        cancel: 'Cancel',
        moveUp: 'Move up',
        moveDown: 'Move down',
      },
    };

    assert.equal(
      isSplitPdfHostToWebviewMessage({
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
          labels,
        },
      }),
      true,
    );
    assert.equal(
      isSplitPdfHostToWebviewMessage({
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
    assert.equal(isSplitPdfWebviewToHostMessage({ type: 'ready' }), true);
    assert.equal(
      isSplitPdfWebviewToHostMessage({
        type: 'previewLoadFailed',
        payload: { message: 'preview failed' },
      }),
      true,
    );
    assert.equal(
      isSplitPdfHostToWebviewMessage({
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
      isSplitPdfWebviewToHostMessage({
        type: 'apply',
        payload: { rows: [{ pages: [2, 2], outputName: 'group.pdf' }] },
      }),
      true,
    );
    assert.equal(
      isSplitPdfWebviewToHostMessage({
        type: 'apply',
        payload: { rows: [{ pages: [], outputName: 'group.pdf' }] },
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
