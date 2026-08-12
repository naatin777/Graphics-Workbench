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
import { execFile } from 'node:child_process';
import { access, copyFile, mkdtempDisposable, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';
import { PDFDocument } from '../../support/helpers/pdf_document.js';

import { convertToPdfFiles, executeChrome, validateSvgToPdfOptions } from '@graphics-workbench/core/conversion';
import { renderPdfPageToPng } from '@graphics-workbench/core/pdf';
import { operationPngInputPath, testInputDirectory } from '../../support/helpers/fixture_paths.js';
import { requireValue } from '../../support/helpers/required.js';

suite('入力画像をPDFへ変換する処理', () => {
  test('2フレームのアニメーションGIFをpage1・page2の2jobに分け、各フレームを1ページのPDFへ変換する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-to-pdf-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPaths = [1, 2].map((page) => path.join(workspacePath.path, `frame-${page}.pdf`));
    await writeAnimatedGif(sourcePath);

    await convertToPdfFiles({
      inputs: outputPaths.map((outputPath, index) => ({
        sourcePath,
        outputPath,
        workspacePath: workspacePath.path,
        page: index + 1,
      })),
      maxInputPixels: 1_000_000_000,
      runtime: {},
    });

    await Promise.all(
      outputPaths.map(async (outputPath) => {
        const document = await PDFDocument.load(await readFile(outputPath));
        assert.strictEqual(document.getPageCount(), 1);
      }),
    );
  });

  test('page未指定の2フレームアニメーションGIFを1jobで渡すと、全フレームを1つのPDFへ統合した2ページPDFを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-gif-to-pdf-all-'));

    const sourcePath = path.join(workspacePath.path, 'source.gif');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await writeAnimatedGif(sourcePath);

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 1_000_000_000,
      runtime: {},
      runId: 'run',
    });

    const pdf = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(pdf.getPageCount(), 2);
  });

  test('ページ寸法が異なる4ページTIFFを1jobで渡すと、先頭ページへ切り詰めず4ページPDFを生成する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-tiff-to-pdf-all-'));

    const sourcePath = path.join(workspacePath.path, 'source.tiff');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await copyFile(path.join(testInputDirectory, 'valid', 'tiff', 'heatmap.tiff'), sourcePath);

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 1_000_000_000,
      runtime: {},
      runId: 'run',
    });

    const pdf = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(pdf.getPageCount(), 4);
    assert.deepStrictEqual(
      [0, 1, 2, 3].map((index) => pdf.getPage(index).getSize()),
      [
        { width: 600, height: 480 },
        { width: 200, height: 160 },
        { width: 64, height: 64 },
        { width: 640, height: 160 },
      ],
    );
  });

  test('PNGを読み込んで1ページのPDFへ変換し、出力PDFのページ数が1であることを確認する', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-png-test-'));
    const sourcePath = path.join(workspacePath.path, 'source.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await copyFile(operationPngInputPath, sourcePath);

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 1_000_000_000,
      runtime: {},
    });

    const { PDFDocument: LoadedPdfDocument } = await import('../../support/helpers/pdf_document.js');
    const pdf = await LoadedPdfDocument.load(await import('node:fs/promises').then((fs) => fs.readFile(outputPath)));
    assert.strictEqual(pdf.getPageCount(), 1);
  });
  test('10x10のPNGに対しmaxInputPixels=99ではpixel上限エラーで変換せず、maxInputPixels=100では変換を実行して出力PDFを作成する', async () => {
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
        inputs: [{ sourcePath, outputPath: limitedOutputPath, workspacePath: workspacePath.path }],
        maxInputPixels: 99,
        runtime: {},
      }),
      /Configured limit: 99 pixels|pixel limit|Input image exceeds pixel limit/,
    );

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 100,
      runtime: {},
    });
    await access(outputPath);
  });

  test('Draw.io runnerが成功終了しても非PDF内容を書き出した場合はunparsable PDFエラーで失敗とし、最終出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-invalid-output-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToPdfFiles({
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
        maxInputPixels: 1_000_000_000,
        runtime: {},
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

  test('Draw.io backend未指定のeditable Draw.io画像はフォールバックせずDraw.io executable未設定エラーで失敗し、最終出力を作成しない', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-pdf-no-drawio-'));
    const sourcePath = path.join(workspacePath.path, 'source.drawio.png');
    const outputPath = path.join(workspacePath.path, 'output.pdf');

    await writeFile(sourcePath, 'editable drawio image placeholder');

    await assert.rejects(
      convertToPdfFiles({
        inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
        maxInputPixels: 1_000_000_000,
        runtime: {},
      }),
      /Draw\.io executable is not configured/,
    );
    await assert.rejects(access(outputPath));
  });

  test('SVGのPDF変換でChrome backendが--headless --no-pdf-header-footerと--print-to-pdf=...result.pdfおよびSVGのfile URLを渡して実行され、SVGサイズの1ページPDFが生成される', async () => {
    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-chrome-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    const calls: { executable: string; args: string[] }[] = [];

    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19"><rect width="31" height="19" /></svg>',
    );

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 1_000_000_000,
      runtime: {},
      tools: {
        svgToPdfTools: {
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath: '/opt/google-chrome',
          runRsvgConvert: async () => {
            throw new Error('rsvg-convert must not run for chrome engine');
          },
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
    assert.match(call?.args[3] ?? '', /result\.pdf\.chrome\.html$/u);

    const document = await PDFDocument.load(await readFile(outputPath));
    assert.deepStrictEqual(document.getPage(0).getSize(), { width: 31, height: 19 });
  });

  test('実Chromeで31x19 SVGいっぱいの矩形をPDFへ印刷すると、ページ全体に内容が残る', async function chromeSvgContentTest() {
    const chromePath = await findChromeExecutable();
    if (chromePath === undefined) {
      this.skip();
      return;
    }

    await using workspacePath = await mkdtempDisposable(path.join(os.tmpdir(), 'gw-svg-chrome-content-'));
    const sourcePath = path.join(workspacePath.path, 'source.svg');
    const outputPath = path.join(workspacePath.path, 'output.pdf');
    await writeFile(
      sourcePath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19"><rect width="31" height="19" fill="#d22" /></svg>',
    );

    await convertToPdfFiles({
      inputs: [{ sourcePath, outputPath, workspacePath: workspacePath.path }],
      maxInputPixels: 1_000_000_000,
      runtime: {},
      tools: {
        svgToPdfTools: {
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath,
          runRsvgConvert: async () => {
            throw new Error('rsvg-convert must not run for chrome engine');
          },
          runChrome: executeChrome,
        },
      },
    });

    const pdf = await PDFDocument.load(await readFile(outputPath));
    assert.deepStrictEqual(pdf.getPage(0).getSize(), { width: 31, height: 19 });
    const rendered = await renderPdfPageToPng(await readFile(outputPath), 1, { dpi: 72 });
    const { data, info } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
    let redPixels = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if ((data[index] ?? 0) > 150 && (data[index + 1] ?? 0) < 120 && (data[index + 2] ?? 0) < 120) {
        redPixels += 1;
      }
    }
    assert.ok(
      redPixels / (info.width * info.height) > 0.9,
      'Chrome PDF content was clipped or left at the default print scale.',
    );
  });

  test('Chrome方式でchromePathが空文字の設定をvalidateSvgToPdfOptionsへ渡すとChrome executable未設定エラーを投げる', () => {
    assert.throws(
      () =>
        validateSvgToPdfOptions({
          engine: 'chrome',
          rsvgConvertPath: 'rsvg-convert',
          chromePath: '',
          runRsvgConvert: async () => {
            throw new Error('rsvg-convert must not run for chrome engine');
          },
          runChrome: async () => {
            throw new Error('chrome must not run when not configured');
          },
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

const execFileAsync = promisify(execFile);

async function findChromeExecutable(): Promise<string | undefined> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(lookupCommand, ['google-chrome'], { encoding: 'utf8' });
    return stdout
      .split(/\r?\n/u)
      .find((line) => line.trim() !== '')
      ?.trim();
  } catch {
    return undefined;
  }
}
