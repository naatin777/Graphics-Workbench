// Test target:
// - PNGをPDFに変換する機能
// - external toolが成功終了しても不正なPDFをcommitしないこと
//
// Mocked:
// - Draw.io CLIの不正出力caseのみrunnerを注入する
//
// Not tested:
// - VS Codeのcommand UI
// - 他の画像フォーマット（JPEG、WebP、Avif、SVG）の実変換

import assert from 'node:assert/strict';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

import { convertToPdfFiles, validateSvgToPdfOptions } from '../../src/operations/conversion/convert_to_pdf.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

suite('PDF変換operation（PNG入力）', () => {
  test('複数フレームのGIF jobは1フレーム1ページPDFとして変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-to-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPaths = [1, 2].map((page) => path.join(workspacePath.path, `frame-${page}.pdf`));
    await writeAnimatedGif(sourcePath);

    await convertToPdfFiles({
      jobs: outputPaths.map((outputPath, index) => ({
        sourcePath,
        outputPath,
        workspacePath: workspacePath.path,
        page: index + 1,
      })),
      supportedExtensions: ['.gif'],
      operationName: 'convert-gif-to-pdf',
    });

    await Promise.all(
      outputPaths.map(async (outputPath) => {
        const document = await PDFDocument.load(await readFile(outputPath));
        assert.strictEqual(document.getPageCount(), 1);
      }),
    );
  });

  test('page未指定のアニメーションGIFは全フレームを1つのPDFへ統合する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-to-pdf-all-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await writeAnimatedGif(sourcePath);

    await convertToPdfFiles({
      jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      supportedExtensions: ['.gif'],
      operationName: 'convert-gif-to-pdf',
      runId: 'run',
    });

    const pdf = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(pdf.getPageCount(), 2);
  });

  test('PNGをPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-png-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await copyFile(operationPngInputPath, sourcePath);

    await convertToPdfFiles({
      jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      supportedExtensions: ['.png'],
      operationName: 'convert-png-to-pdf',
    });

    const { PDFDocument: LoadedPdfDocument } = await import('pdf-lib');
    const pdf = await LoadedPdfDocument.load(await import('node:fs/promises').then((fs) => fs.readFile(outputPath)));
    assert.strictEqual(pdf.getPageCount(), 1);
  });
  test('preflightと実変換で設定pixel上限を共有する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-png-pixel-limit-'));
    const sourcePath = path.join(workspacePath.path, 'ten-by-ten.png');
    const limitedOutputPath = path.join(workspacePath.path, 'limited-output.pdf');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 32, g: 64, b: 96, alpha: 1 },
      },
    })
      .png()
      .toFile(sourcePath);

    await assert.rejects(
      convertToPdfFiles({
        jobs: [{ sourcePath, outputPath: limitedOutputPath, workspacePath: workspacePath.path }],
        maxInputPixels: 99,
        supportedExtensions: ['.png'],
        operationName: 'convert-png-to-pdf',
      }),
      /Configured limit: 99 pixels|pixel limit|Input image exceeds pixel limit/,
    );

    await convertToPdfFiles({
      jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 100,
      supportedExtensions: ['.png'],
      operationName: 'convert-png-to-pdf',
    });
    await access(outputPath);
  });

  test('Draw.io runnerが成功終了しても非PDF出力をcommitしない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-invalid-output-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToPdfFiles({
        jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
        supportedExtensions: ['.drawio.png'],
        operationName: 'convert-to-pdf',
        tools: {
          drawioTools: {
            drawioPath: 'drawio',
            runDrawio: async (_executable, args) => {
              await writeFile(requireValue(args[args.indexOf('-o') + 1]), 'not a PDF');
            },
          },
        },
      }),
      /unparsable PDF/,
    );
    await assert.rejects(access(outputPath));
  });

  test('Draw.io backend未指定のeditable Draw.io画像はフォールバックせず失敗する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-no-drawio-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToPdfFiles({
        jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
        supportedExtensions: ['.drawio.png'],
        operationName: 'convert-to-pdf',
      }),
      /Draw\.io executable is not configured/,
    );
    await assert.rejects(access(outputPath));
  });

  test('Chrome backendはheadless印刷のCLI引数でSVGをPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-chrome-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const calls: { executable: string; args: string[] }[] = [];

    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19"><rect width="31" height="19" /></svg>',
    );

    await convertToPdfFiles({
      jobs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      supportedExtensions: ['.svg'],
      operationName: 'convert-svg-to-pdf',
      tools: {
        svgToPdfTools: {
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath: '/opt/google-chrome',
          runChrome: async (executable, args) => {
            calls.push({ executable, args });
            const pdf = await PDFDocument.create();
            pdf.addPage([7, 11]);
            const outputArgument = args.find((argument) => argument.startsWith('--print-to-pdf='));
            assert.ok(outputArgument);
            await writeFile(outputArgument.slice('--print-to-pdf='.length), await pdf.save());
          },
        },
      },
    });

    const [call] = calls;
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(call?.executable, '/opt/google-chrome');
    assert.deepStrictEqual(call?.args.slice(0, 2), ['--headless', '--no-pdf-header-footer']);
    assert.match(call?.args[2] ?? '', /^--print-to-pdf=.+result\.pdf$/u);
    assert.strictEqual(call?.args[3], pathToFileURL(sourcePath).href);

    const document = await PDFDocument.load(await readFile(outputPath));
    assert.deepStrictEqual(document.getPage(0).getSize(), { width: 31, height: 19 });
  });

  test('Chrome方式ではChrome実行ファイルの指定を必須にする', () => {
    assert.throws(
      () =>
        validateSvgToPdfOptions({
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath: '',
        }),
      /Chrome executable is not configured/,
    );
  });
});

async function writeAnimatedGif(filePath: string): Promise<void> {
  const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer();
  const blue = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#0000ff' } })
    .png()
    .toBuffer();
  await sharp([red, blue], { join: { animated: true } })
    .gif()
    .toFile(filePath);
}
