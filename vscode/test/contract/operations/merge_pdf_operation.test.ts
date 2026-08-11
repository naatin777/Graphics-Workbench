import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { recordConversionForUndo } from '../../../src/commands/lifecycle/undo_last_conversion.js';
import { mergePdf } from '../../../src/operations/pdf/merge_pdf.js';
import {
  createConversionUndoRecord,
  undoConversionOutputs,
} from '../../../src/operations/lifecycle/undo_last_conversion.js';
import { operationPdfInputDirectory } from '../../support/helpers/fixture_paths.js';

const firstFixturePath = path.join(operationPdfInputDirectory, 'multi-page-table.pdf');
const secondFixturePath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');

suite('複数PDFの結合と、既存出力への反映・取り消し', () => {
  test('出力先に既存のmerged.pdfがある状態で2つのPDFを結合し、競合解決で両方残すを選ぶと結果をmerged-1.pdfとして出力し、既存ファイルは変更せず一時作業フォルダを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));

    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    await copyFile(firstFixturePath, firstPath);
    await copyFile(secondFixturePath, secondPath);
    await writeFile(outputPath, 'existing output');

    const outputs = await mergePdf({
      sourcePaths: [firstPath, secondPath],
      outputPath,
      workspacePath: workspacePath.path,
      runId: 'safe-mode',
      runtime: { resolveConflicts: async () => 'keep-both' },
    });
    await recordConversionForUndo(outputs);

    assert.strictEqual(outputs[0]?.outputPath, path.join(workspacePath.path, 'merged-1.pdf'));
    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing output');
    await assert.rejects(access(path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'safe-mode')));
  });

  test('出力先に既存PDFがある状態で競合解決の上書きを選んで結合し、その後のundo操作で上書き前の既存PDFの中身を復元する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));

    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    await copyFile(firstFixturePath, firstPath);
    await copyFile(secondFixturePath, secondPath);
    await copyFile(firstFixturePath, outputPath);
    const originalOutput = await readFile(outputPath);

    const outputs = await mergePdf({
      sourcePaths: [firstPath, secondPath],
      outputPath,
      workspacePath: workspacePath.path,
      runId: 'undo',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });
    const undoRecord = await createConversionUndoRecord(outputs);

    await undoConversionOutputs(undoRecord);

    assert.deepStrictEqual(await readFile(outputPath), originalOutput);
  });

  test('変換開始前にabort済みsignalを渡すとAbortErrorで失敗し、出力PDFを作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));

    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    await copyFile(firstFixturePath, firstPath);
    await copyFile(secondFixturePath, secondPath);
    const abortController = new AbortController();
    abortController.abort();

    await assert.rejects(
      mergePdf({
        sourcePaths: [firstPath, secondPath],
        outputPath,
        workspacePath: workspacePath.path,
        runtime: {
          signal: abortController.signal,
          resolveConflicts: async () => 'overwrite',
        },
      }),
      { name: 'AbortError' },
    );
    await assert.rejects(access(outputPath));
  });

  test('入力がworkspace外のファイルへのsymlinkの場合、workspace境界検証で読み込み前に拒否し、外部ファイルを読まず出力も一時ファイルも作らない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));
    await using outsidePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-outside-'));

    const linkedSourcePath = path.join(workspacePath.path, 'linked.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'boundary');
    const outsideSourcePath = path.join(outsidePath.path, 'malformed.pdf');

    await writeFile(outsideSourcePath, 'not a PDF');
    await symlink(outsideSourcePath, linkedSourcePath);
    await copyFile(secondFixturePath, secondPath);

    await assert.rejects(
      mergePdf({
        sourcePaths: [linkedSourcePath, secondPath],
        outputPath,
        workspacePath: workspacePath.path,
        runId: 'boundary',
      }),
      /outside the workspace/,
    );

    await assert.rejects(access(outputPath));
    await assert.rejects(access(stagingRootPath));
  });

  test('既存の出力ファイルに対する競合解決でキャンセルを選ぶと結合を中止し、既存出力を維持したまま一時作業フォルダを削除する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-merge-operation-'));

    const firstPath = path.join(workspacePath.path, 'first.pdf');
    const secondPath = path.join(workspacePath.path, 'second.pdf');
    const outputPath = path.join(workspacePath.path, 'merged.pdf');
    const stagingRootPath = path.join(workspacePath.path, '.graphics-workbench', 'merge-pdf', 'cancelled');
    await copyFile(firstFixturePath, firstPath);
    await copyFile(secondFixturePath, secondPath);
    await writeFile(outputPath, 'existing output');

    await assert.rejects(
      mergePdf({
        sourcePaths: [firstPath, secondPath],
        outputPath,
        workspacePath: workspacePath.path,
        runId: 'cancelled',
        runtime: { resolveConflicts: async () => 'cancel' },
      }),
      /cancelled/,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing output');
    await assert.rejects(access(stagingRootPath));
  });
});
