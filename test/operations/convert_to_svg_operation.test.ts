// Test target:
// - editable Draw.io画像をSVGへ変換するとき、Draw.io CLIへSVG出力を要求すること
// - 変換結果を.graphics-workbench配下で作成してから指定出力先へ反映すること
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

import { PDFDocument } from 'pdf-lib';

import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { requireValue } from '../helpers/required.js';

suite('SVGに変換する処理', () => {
  test('編集可能なDraw.io画像はDraw.io CLIでSVGへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.svg');
    const drawioCalls: string[][] = [];
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await convertToSvgFiles({
      jobs: [
        {
          sourcePath,
          outputPath,
          workspacePath: workspacePath.path,
          page: 1,
        },
      ],
      mermaidTools: {
        chromePath: 'chrome',
        mermaidPath: 'mmdc',
        theme: 'default',
        backgroundColor: 'white',
      },
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
    });

    assert.strictEqual(drawioCalls.length, 1);
    const args = requireValue(drawioCalls[0]);
    assert.deepStrictEqual(args.slice(0, 5), [
      '-x',
      '-f',
      'svg',
      '-o',
      path.join(workspacePath.path, '.graphics-workbench', 'convert-to-svg', 'test-run', '1', 'result.svg'),
    ]);
    assert.strictEqual(args.at(-1), sourcePath);
    assert.match(await readFile(outputPath, 'utf8'), /<svg[\s>]/);
  });

  test('Draw.io CLIが成功終了しても非SVG出力をcommitしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-invalid-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source.svg');
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToSvgFiles({
        jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path, page: 1 }],
        mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: async (_executable, args) => {
            await writeFile(requireValue(args[args.indexOf('-o') + 1]), '<html>not svg</html>');
          },
        },
        runId: 'invalid-output',
      }),
      /non-SVG output/,
    );
    await assert.rejects(access(outputPath));
  });

  test('Draw.io CLIの失敗をstderrつきのエラーに包む', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'source', '1.svg');
    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToSvgFiles({
        jobs: [
          {
            sourcePath,
            outputPath,
            workspacePath: workspacePath.path,
            page: 1,
          },
        ],
        mermaidTools: {
          chromePath: 'chrome',
          mermaidPath: 'mmdc',
          theme: 'default',
          backgroundColor: 'white',
        },
        drawioTools: {
          drawioPath: 'drawio',
          runDrawio: async () => {
            throw errorWithStderr('spawn drawio ENOENT', 'drawio missing');
          },
        },
        runId: 'test-run',
      }),
      /Draw\.io CLI failed: spawn drawio ENOENT\ndrawio missing/,
    );
  });

  test('PDF rendererが成功終了しても空SVGをcommitしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-empty-'));

    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'source.svg');
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    await writeFile(sourcePath, await pdfDoc.save());

    await assert.rejects(
      convertToSvgFiles({
        jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path, page: 1 }],
        mermaidTools: { chromePath: 'chrome', mermaidPath: 'mmdc', theme: 'default', backgroundColor: 'white' },
        drawioTools: { drawioPath: 'drawio' },
        runPdfToSvg: async (_sourcePath, toolOutputPath) => {
          await writeFile(toolOutputPath, '');
        },
        runId: 'empty-output',
      }),
      /empty output/,
    );
    await assert.rejects(access(outputPath));
  });

  test('PDF→SVG変換の失敗をstderrつきのエラーに包む', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-convert-to-svg-operation-'));

    const sourcePath = path.join(workspacePath.path, 'source.pdf');
    const outputPath = path.join(workspacePath.path, 'source-1.svg');
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    await writeFile(sourcePath, await pdfDoc.save());

    await assert.rejects(
      convertToSvgFiles({
        jobs: [
          {
            sourcePath,
            outputPath,
            workspacePath: workspacePath.path,
            page: 1,
          },
        ],
        mermaidTools: {
          chromePath: 'chrome',
          mermaidPath: 'mmdc',
          theme: 'default',
          backgroundColor: 'white',
        },
        drawioTools: {
          drawioPath: 'drawio',
        },
        runPdfToSvg: async () => {
          throw errorWithStderr('Command failed: pdf-render', 'syntax error');
        },
        runId: 'test-run',
      }),
      /PDF to SVG conversion failed: Command failed: pdf-render\nsyntax error/,
    );
  });
});

function errorWithStderr(message: string, stderr: string): Error & { stderr: string } {
  return Object.assign(new Error(message), { stderr });
}
