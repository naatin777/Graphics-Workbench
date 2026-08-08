import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { recordConversionForUndo } from '../../src/commands/lifecycle/undo_last_conversion.js';
import { mergePdf } from '../../src/operations/pdf/merge_pdf.js';
import {
  createConversionUndoRecord,
  undoConversionOutputs,
} from '../../src/operations/lifecycle/undo_last_conversion.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';

const firstFixturePath = path.join(operationPdfInputDirectory, 'multi-page-table.pdf');
const secondFixturePath = path.join(operationPdfInputDirectory, 'multilingual-text.pdf');

suite('PDF結合operation', () => {
  test('結合結果をstagingへ作成してSafe Modeの両方残すを適用する', async () => {
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

  test('上書き後のUndoで既存PDFを復元する', async () => {
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

  test('変換開始前にキャンセルされた場合は出力を作成しない', async () => {
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

  test('preflightより先にworkspace境界を検証し、外部symlink入力を読み込まない', async () => {
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

  test('競合解決でキャンセルされた場合はstagingを削除し既存出力を維持する', async () => {
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
