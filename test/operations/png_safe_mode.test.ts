// Test target:
// - 複数PNGをすべてステージングしてから1回で出力先へ反映すること
// - Safe Modeの両方残す・上書きしない・上書きするがバッチ全体へ適用されること
// - 変換失敗とキャンセル時に指定出力先へ何も反映しないこと
// - 上書き後の直前変換取消で元ファイルを復元すること
// - editable Draw.io画像変換にもSafe ModeとUndoが効くこと
//
// Mocked:
// - Safe Modeの競合判断
//
// Not tested:
// - VS Codeのダイアログとstatus barの描画
// - VS CodeのwithProgress表示
// - JPEG/WebP/AVIF/SVG/Mermaid

import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../helpers/pdf_document.js';

import { convertToPdfFiles, type ConvertToPdfJob } from '../../src/operations/conversion/convert_to_pdf.js';
import type { RunDrawio } from '../../src/operations/conversion/tools/drawio_tools.js';
import {
  createConversionUndoRecord,
  undoConversionOutputs,
} from '../../src/operations/lifecycle/undo_last_conversion.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

const fixturePath = operationPngInputPath;
const editableDrawioImageExtensions = ['.drawio.png', '.dio.png', '.drawio.svg', '.dio.svg'] as const;

suite('PNG→PDF変換での既存出力の競合処理と復元（Safe Mode）', () => {
  test('2件のPNG→PDF変換を実行すると、各結果を一時フォルダに作成してから出力PDFへ反映し、一時作業ディレクトリにはジョブごとのresult.pdfが残る', async () => {
    const { workspacePath, jobs } = await createJobs(['first', 'second']);

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      runId: 'batch-success',
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.strictEqual(outputs.length, 2);

    for (const job of jobs) {
      const pdf = await PDFDocument.load(await readFile(job.outputPath));
      assert.strictEqual(pdf.getPageCount(), 1);
    }

    const stagedRoot = path.join(workspacePath, '.graphics-workbench', 'convert-to-pdf', 'batch-success');
    assert.deepStrictEqual(new Set(await readdir(stagedRoot)), new Set(['1', '2']));
    await assert.doesNotReject(access(path.join(stagedRoot, '1', 'result.pdf')));
    await assert.doesNotReject(access(path.join(stagedRoot, '2', 'result.pdf')));
  });

  test('2件の出力先がすべて競合するまとめ変換で競合解決を1回だけ呼び、両方残すを選ぶと既存出力を変更せずfirst-2.pdfとsecond-1.pdfとして保存する', async () => {
    const { workspacePath, jobs } = await createJobs(['first', 'second']);
    await writeFile(requireValue(jobs[0]).outputPath, 'old-first');
    await writeFile(requireValue(jobs[1]).outputPath, 'old-second');
    await writeFile(path.join(workspacePath, 'first-1.pdf'), 'reserved');
    const decisions: string[][] = [];

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      runtime: {
        resolveConflicts: async (conflicts) => {
          decisions.push(conflicts);
          return 'keep-both';
        },
      },
    });

    assert.strictEqual(decisions.length, 1);
    assert.deepStrictEqual(new Set(decisions[0]), new Set(jobs.map((job) => job.outputPath)));
    assert.deepStrictEqual(
      new Set(outputs.map((output) => output.outputPath)),
      new Set([path.join(workspacePath, 'first-2.pdf'), path.join(workspacePath, 'second-1.pdf')]),
    );
    assert.strictEqual(await readFile(requireValue(jobs[0]).outputPath, 'utf8'), 'old-first');
    assert.strictEqual(await readFile(requireValue(jobs[1]).outputPath, 'utf8'), 'old-second');
  });

  test('競合解決でキャンセルを選ぶと変換全体を中止し、既存の出力ファイルは変更せず未作成の出力も作成しない', async () => {
    const { jobs } = await createJobs(['first', 'second']);
    await writeFile(requireValue(jobs[0]).outputPath, 'old-first');

    await assert.rejects(
      convertToPdfFiles({
        jobs,
        maxInputPixels: 1_000_000_000,
        runtime: { resolveConflicts: async () => 'cancel' },
      }),
      /cancelled/,
    );

    assert.strictEqual(await readFile(requireValue(jobs[0]).outputPath, 'utf8'), 'old-first');
    await assert.rejects(access(requireValue(jobs[1]).outputPath));
  });

  test('後続ジョブのPNGが不正で変換が失敗すると、先行ジョブの出力も含めてどの出力ファイルも作成しない', async () => {
    const { workspacePath, jobs } = await createJobs(['first', 'second']);
    const invalidSourcePath = path.join(workspacePath, 'invalid.png');
    await writeFile(invalidSourcePath, 'not a PNG');
    jobs[1] = {
      ...requireValue(jobs[1]),
      sourcePath: invalidSourcePath,
    };

    await assert.rejects(
      convertToPdfFiles({
        jobs,
        maxInputPixels: 1_000_000_000,
        runtime: { resolveConflicts: async () => 'overwrite' },
      }),
    );

    await Promise.all(jobs.map((job) => assert.rejects(access(job.outputPath))));
  });

  test('上書きした各出力の元ファイルをバックアップし、undo操作で上書き前の内容へ復元する', async () => {
    const { jobs } = await createJobs(['first', 'second']);
    await writeFile(requireValue(jobs[0]).outputPath, 'old-first');
    await writeFile(requireValue(jobs[1]).outputPath, 'old-second');

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      runtime: { resolveConflicts: async () => 'overwrite' },
    });
    const undoRecord = await createConversionUndoRecord(outputs);

    assert.ok(outputs.every((output) => output.previousFilePath));
    await undoConversionOutputs(undoRecord);

    assert.strictEqual(await readFile(requireValue(jobs[0]).outputPath, 'utf8'), 'old-first');
    assert.strictEqual(await readFile(requireValue(jobs[1]).outputPath, 'utf8'), 'old-second');
  });

  test('変換開始前にabort済みsignalを渡すとAbortErrorで失敗し、どの出力ファイルも作成しない', async () => {
    const { jobs } = await createJobs(['first', 'second']);
    const abortController = new AbortController();
    abortController.abort();

    await assert.rejects(
      convertToPdfFiles({
        jobs,
        maxInputPixels: 1_000_000_000,
        runtime: {
          signal: abortController.signal,
          resolveConflicts: async () => 'overwrite',
        },
      }),
      { name: 'AbortError' },
    );

    await Promise.all(jobs.map((job) => assert.rejects(access(job.outputPath))));
  });

  test('編集可能なDraw.io PNG/SVGをsupportedExtensionsに指定し、注入したDraw.io runnerで各ソースを1ページPDFへ変換する', async () => {
    const { jobs } = await createEditableDrawioJobs([
      ['source.drawio.png', 'source.pdf'],
      ['diagram.dio.svg', 'diagram.pdf'],
    ]);
    const calls: string[][] = [];

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      supportedExtensions: editableDrawioImageExtensions,
      tools: {
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: createPdfWritingDrawioRunner(calls),
        },
      },
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    assert.strictEqual(outputs.length, 2);
    assert.deepStrictEqual(new Set(calls.map((args) => args.at(-1))), new Set(jobs.map((job) => job.sourcePath)));

    for (const job of jobs) {
      const pdf = await PDFDocument.load(await readFile(job.outputPath));
      assert.strictEqual(pdf.getPageCount(), 1);
    }
  });

  test('編集可能なDraw.io画像の出力先が既存の場合に両方残すを選ぶと、既存出力を変更せずsource-1.pdfとして保存する', async () => {
    const { jobs, workspacePath } = await createEditableDrawioJobs([['source.drawio.png', 'source.pdf']]);
    const originalOutputPath = requireValue(jobs[0]).outputPath;
    const keptOutputPath = path.join(workspacePath, 'source-1.pdf');
    await writeFile(originalOutputPath, 'old output');

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      supportedExtensions: editableDrawioImageExtensions,
      tools: {
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: createPdfWritingDrawioRunner(),
        },
      },
      runtime: { resolveConflicts: async () => 'keep-both' },
    });

    assert.deepStrictEqual(
      outputs.map((output) => output.outputPath),
      [keptOutputPath],
    );
    assert.strictEqual(await readFile(originalOutputPath, 'utf8'), 'old output');
    const pdf = await PDFDocument.load(await readFile(keptOutputPath));
    assert.strictEqual(pdf.getPageCount(), 1);
  });

  test('編集可能なDraw.io画像の出力を上書きした際の元ファイルをバックアップし、undo操作で上書き前の内容を復元する', async () => {
    const { jobs } = await createEditableDrawioJobs([['source.drawio.png', 'source.pdf']]);
    await writeFile(requireValue(jobs[0]).outputPath, 'old output');

    const outputs = await convertToPdfFiles({
      jobs,
      maxInputPixels: 1_000_000_000,
      supportedExtensions: editableDrawioImageExtensions,
      tools: {
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: createPdfWritingDrawioRunner(),
        },
      },
      runtime: { resolveConflicts: async () => 'overwrite' },
    });

    const undoRecord = await createConversionUndoRecord(outputs);
    await undoConversionOutputs(undoRecord);

    assert.strictEqual(await readFile(requireValue(jobs[0]).outputPath, 'utf8'), 'old output');
  });
});

async function createJobs(names: string[]): Promise<{
  workspacePath: string;
  jobs: ConvertToPdfJob[];
}> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-png-safe-test-'));
  const jobs = await Promise.all(
    names.map(async (name) => {
      const sourcePath = path.join(workspacePath, `${name}.png`);
      await copyFile(fixturePath, sourcePath);

      return {
        sourcePath,
        outputPath: path.join(workspacePath, `${name}.pdf`),
        workspacePath,
      };
    }),
  );

  return { workspacePath, jobs };
}

async function createEditableDrawioJobs(entries: [sourceName: string, outputName: string][]): Promise<{
  workspacePath: string;
  jobs: ConvertToPdfJob[];
}> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'gw-drawio-safe-test-'));
  const jobs = await Promise.all(
    entries.map(async ([sourceName, outputName]) => {
      const sourcePath = path.join(workspacePath, sourceName);
      await writeFile(sourcePath, 'editable drawio image');

      return {
        sourcePath,
        outputPath: path.join(workspacePath, outputName),
        workspacePath,
      };
    }),
  );

  return { workspacePath, jobs };
}

function createPdfWritingDrawioRunner(calls: string[][] = []): RunDrawio {
  return async (_executable, args) => {
    calls.push(args);
    const outputPath = args[args.indexOf('-o') + 1];
    assert.ok(outputPath);
    const document = await PDFDocument.create();
    document.addPage([120, 80]);
    await writeFile(outputPath, await document.save());
  };
}
