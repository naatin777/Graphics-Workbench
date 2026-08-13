// Test target:
// - editable Draw.io画像をSVGへ変換するとき、Draw.io CLIへSVG出力を要求すること
// - Draw.io CLI / PDF renderer の失敗をユーザー向けエラーに包むこと
// - external toolが成功終了しても不正なSVGをcommitしないこと
//
// Not tested:
// - Draw.io CLI実体での変換
// - PDF → SVGの実変換経路
// - Safe Modeダイアログの画面表示

import assert from 'node:assert/strict';
import { access, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from '../../../test-support/pdf_document.js';

import { convertToSvgFiles, executeDrawio } from '@graphics-workbench/core/conversion';
import { requireValue } from '../helpers/required.js';

function stubRunPdfToSvg(sourcePath: string, outputPath: string, _page: number, _signal: AbortSignal): Promise<void> {
  throw new Error(`PDF to SVG must not run in this test: ${sourcePath} -> ${outputPath}`);
}

suite('Draw.io画像とPDFをSVGへ変換する処理', () => {
  test('編集可能なDraw.io画像をDraw.io CLIへ-f svgオプションで一時作業ファイルへ出力させ、その結果を最終出力先へ反映する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.svg');
    const drawioCalls: string[][] = [];
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await convertToSvgFiles({
      inputs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          page: 1,
        },
      ],
      runtime: {},
      drawioTools: {
        drawioPath: 'drawio',
        runDrawio: async (_executable, args) => {
          drawioCalls.push(args);
          const outputIndex = args.indexOf('-o') + 1;
          assert.ok(outputIndex > 0);
          await writeFile(requireValue(args[outputIndex]), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        },
      },
      runId: 'test-run',
      runPdfToSvg: stubRunPdfToSvg,
      maxInputPixels: 1_000_000_000,
    });

    assert.strictEqual(drawioCalls.length, 1);
    const args = requireValue(drawioCalls[0]);
    assert.strictEqual(args[0], '-x');
    assert.strictEqual(args[1], '-f');
    assert.strictEqual(args[2], 'svg');
    assert.strictEqual(args[3], '-o');
    assert.ok(args[4]?.endsWith('.svg'));
    assert.strictEqual(args.at(-1), sourcePath);
    assert.match(await readFile(outputPath, 'utf8'), /<svg[\s>]/);
  });

  test('Draw.io CLIが成功終了しても非SVG内容を書き出した場合はnon-SVG outputエラーで失敗とし、最終出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-invalid-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source.svg');
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToSvgFiles({
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path, page: 1 }],
        runtime: {},
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: async (_executable, args) => {
            await writeFile(requireValue(args[args.indexOf('-o') + 1]), '<html>not svg</html>');
          },
        },
        runId: 'invalid-output',
        runPdfToSvg: stubRunPdfToSvg,
        maxInputPixels: 1_000_000_000,
      }),
      /non-SVG output/,
    );
    await assert.rejects(access(outputPath));
  });

  test('Draw.io CLIの起動がspawn drawio ENOENTで失敗すると、stderr内容を添えたDraw.io CLI failedエラーに包んで変換を失敗させる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.svg');
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToSvgFiles({
        inputs: [
          {
            sourcePath,
            outputPath,
            workspacePath: workspacePath.path,
            page: 1,
          },
        ],
        runtime: {},
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: async () => {
            throw errorWithStderr('spawn drawio ENOENT', 'drawio missing');
          },
        },
        runId: 'test-run',
        runPdfToSvg: stubRunPdfToSvg,
        maxInputPixels: 1_000_000_000,
      }),
      /Draw\.io CLI failed: spawn drawio ENOENT\ndrawio missing/,
    );
  });

  test('PDF→SVG変換が成功終了しても空ファイルを書き出した場合はempty outputエラーで失敗とし、最終出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-empty-'));

    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'source.svg');
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    await writeFile(sourcePath, await pdfDoc.save());

    await assert.rejects(
      convertToSvgFiles({
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path, page: 1 }],
        runtime: {},
        drawioTools: { drawioPath: 'drawio', runDrawio: executeDrawio },
        runPdfToSvg: async (_sourcePath, toolOutputPath) => {
          await writeFile(toolOutputPath, '');
        },
        runId: 'empty-output',
        maxInputPixels: 1_000_000_000,
      }),
      /empty output/,
    );
    await assert.rejects(access(outputPath));
  });

  test('PDF→SVG変換がCommand failedで失敗すると、stderr内容を添えたPDF to SVG input failedエラーに包んで変換を失敗させる', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'source-1.svg');
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    await writeFile(sourcePath, await pdfDoc.save());

    await assert.rejects(
      convertToSvgFiles({
        inputs: [
          {
            sourcePath,
            outputPath,
            workspacePath: workspacePath.path,
            page: 1,
          },
        ],
        runtime: {},
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: executeDrawio,
        },
        runPdfToSvg: async () => {
          throw errorWithStderr('Command failed: pdf-render', 'syntax error');
        },
        runId: 'test-run',
        maxInputPixels: 1_000_000_000,
      }),
      /PDF to SVG input failed: Command failed: pdf-render\nsyntax error/,
    );
  });
});

function errorWithStderr(message: string, stderr: string): Error & { stderr: string } {
  return Object.assign(new Error(message), { stderr });
}
