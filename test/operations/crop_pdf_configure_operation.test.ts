// Test target:
// - 固定PDF fixtureを使った全ページ・選択ページのconfigure crop結果
// - 日本語、絵文字、空白を含む入力名とoutputPathテンプレート
//
// Mocked:
// - なし
//
// Not tested:
// - VS Code Webviewとcommandのmessage接続
// - Safe Modeのdialog

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { PDFDocument, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';

import { readPdftocairoExecutablePath } from '../../src/config/external_tools/external_tool_paths.js';
import { getExtensionConfiguration } from '../../src/generated-extension-config.js';
import { resolveOutputPath } from '../../src/config/output/resolve_output_path.js';
import { cropPdfWithConfiguredBox, type CropBox } from '../../src/operations/pdf/crop_pdf_configure.js';

import { cropConfigureFixture } from '../helpers/crop_configure_fixture.js';
import { operationPdfInputDirectory } from '../helpers/fixture_paths.js';
import { RecordingOutputChannel } from '../helpers/recording_output_channel.js';
import { assertWorkspaceChangesSince, captureWorkspaceSnapshot } from '../helpers/workspace_snapshot.js';

const execFileAsync = promisify(execFile);
suite('PDF configure crop処理', () => {
  const temporaryDirectories: string[] = [];

  teardown(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          recursive: true,
          force: true,
        }),
      ),
    );
  });

  test('固定fixtureの全ページを同じboxでcropし、描画内容の位置を維持する', async () => {
    const workspacePath = await createTemporaryWorkspace(temporaryDirectories);
    const renderDirectory = await createTemporaryRenderDirectory(temporaryDirectories);
    const sourcePath = await copyFixtureToWorkspace(workspacePath, cropConfigureFixture.fileName, '入力 PDF');
    const outputPath = path.join(workspacePath, '出力 PDF', 'q a-all-crop.pdf');
    const cropBox = cropConfigureFixture.cropBox;
    const logs = new RecordingOutputChannel();
    const before = await captureWorkspaceSnapshot(workspacePath);

    const outputs = await cropPdfWithConfiguredBox({
      job: {
        sourcePath,
        workspacePath,
        outputPath,
        cropBox,
        target: { type: 'all' },
      },
      runId: 'all-pages',
      runtime: { outputChannel: logs },
    });

    assert.deepStrictEqual(outputs, [
      {
        outputPath,
        workspacePath,
        stagingRootPath: path.join(workspacePath, '.graphics-workbench', 'crop-pdf-configure', 'all-pages'),
      },
    ]);

    const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(outputDocument.getPageCount(), 2);
    for (const [index, page] of outputDocument.getPages().entries()) {
      assertCropBox(page, cropBox);
      assert.deepStrictEqual(page.getMediaBox(), sourceDocument.getPage(index)?.getMediaBox());
    }

    const after = await captureWorkspaceSnapshot(workspacePath);
    assertWorkspaceChangesSince(before, after, {
      created: [
        path.join('出力 PDF', 'q a-all-crop.pdf'),
        path.join(
          '.graphics-workbench',
          'crop-pdf-configure',
          'all-pages',
          'multilingual-text',
          'multilingual-text.pdf',
        ),
        path.join('.graphics-workbench', 'crop-pdf-configure', 'all-pages', 'multilingual-text', 'result.pdf'),
      ],
    });
    assert.ok(logs.hasLine('[crop-pdf-configure] staging-validated'));
    assert.ok(logs.hasLine('[crop-pdf-configure] operation-completed'));
    assert.equal(logs.hasLine(/operation-failed|operation-cancelled/iu), false);

    await assertRenderedCropMatchesSource({
      sourcePath,
      outputPath,
      pageNumber: 1,
      cropBox,
      temporaryDirectory: renderDirectory,
    });
    await assertRenderedCropMatchesSource({
      sourcePath,
      outputPath,
      pageNumber: 2,
      cropBox,
      temporaryDirectory: renderDirectory,
    });
  });

  test('選択ページだけをcropし、未選択ページと元fixtureを変更しない', async () => {
    const workspacePath = await createTemporaryWorkspace(temporaryDirectories);
    const renderDirectory = await createTemporaryRenderDirectory(temporaryDirectories);
    const sourcePath = await copyFixtureToWorkspace(workspacePath, cropConfigureFixture.fileName, '選択元');
    const outputPath = path.join(workspacePath, '選択結果', 'q a-selected-crop.pdf');
    const cropBox = cropConfigureFixture.cropBox;
    const before = await captureWorkspaceSnapshot(workspacePath);

    await cropPdfWithConfiguredBox({
      job: {
        sourcePath,
        workspacePath,
        outputPath,
        cropBox,
        target: { type: 'selected', pages: [1, 1] },
      },
      runId: 'selected-pages',
    });

    const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
    const outputDocument = await PDFDocument.load(await readFile(outputPath));
    assert.strictEqual(outputDocument.getPageCount(), 2);
    assertCropBox(outputDocument.getPage(0), cropBox);
    assert.deepStrictEqual(outputDocument.getPage(0).getMediaBox(), sourceDocument.getPage(0).getMediaBox());
    assert.deepStrictEqual(outputDocument.getPage(1).getMediaBox(), sourceDocument.getPage(1).getMediaBox());
    assert.deepStrictEqual(outputDocument.getPage(1).getCropBox(), sourceDocument.getPage(1).getCropBox());

    await assertRenderedCropMatchesSource({
      sourcePath,
      outputPath,
      pageNumber: 1,
      cropBox,
      temporaryDirectory: renderDirectory,
    });
    await assertRenderedPagesSimilar({
      expectedPdfPath: sourcePath,
      expectedPageNumber: 2,
      actualPdfPath: outputPath,
      actualPageNumber: 2,
      temporaryDirectory: renderDirectory,
      prefix: 'unselected-page',
    });

    assert.deepStrictEqual(await readFile(sourcePath), await readFile(inputFixturePath(cropConfigureFixture.fileName)));
    const after = await captureWorkspaceSnapshot(workspacePath);
    assertWorkspaceChangesSince(before, after, {
      created: [
        path.join('選択結果', 'q a-selected-crop.pdf'),
        path.join(
          '.graphics-workbench',
          'crop-pdf-configure',
          'selected-pages',
          'multilingual-text',
          'multilingual-text.pdf',
        ),
        path.join('.graphics-workbench', 'crop-pdf-configure', 'selected-pages', 'multilingual-text', 'result.pdf'),
      ],
    });
  });

  test('child成功後に既存outputへのcommitが失敗すると、既存outputを維持しstagingだけをcleanupする', async () => {
    const workspacePath = await createTemporaryWorkspace(temporaryDirectories);
    const sourcePath = await copyFixtureToWorkspace(workspacePath, cropConfigureFixture.fileName, 'commit失敗元');
    const outputPath = path.join(workspacePath, 'commit-failure', 'result.pdf');
    const logs = new RecordingOutputChannel();
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'existing output');
    const before = await captureWorkspaceSnapshot(workspacePath);

    await assert.rejects(
      cropPdfWithConfiguredBox({
        job: {
          sourcePath,
          workspacePath,
          outputPath,
          cropBox: cropConfigureFixture.cropBox,
          target: { type: 'all' },
        },
        runId: 'commit-failure',
        runtime: { outputChannel: logs },
      }),
      /Output file already exists/iu,
    );

    assert.strictEqual(await readFile(outputPath, 'utf8'), 'existing output');
    const after = await captureWorkspaceSnapshot(workspacePath);
    assertWorkspaceChangesSince(before, after, {});
    assert.ok(logs.hasLine('child-success-received'));
    assert.ok(logs.hasLine('[crop-pdf-configure] staging-cleaned'));
    assert.ok(logs.hasLine('[crop-pdf-configure] operation-failed'));
    assert.equal(logs.hasLine('[crop-pdf-configure] operation-completed'), false);
  });

  test('多言語・複雑なUnicode・半角全角空白を保ち、複数のoutputPathへ出力する', async () => {
    const workspacePath = await createTemporaryWorkspace(temporaryDirectories);
    const sourceFixtureFileName = 'single-page-document.pdf';
    const sourceFileName = cropConfigureFixture.complexUnicodeFileName;
    const sourceBaseName = path.basename(sourceFileName, path.extname(sourceFileName));
    const relativeSourceDirectory = '入力 Multilingual　자료🌏';
    const sourcePath = await copyFixtureToWorkspace(
      workspacePath,
      sourceFixtureFileName,
      relativeSourceDirectory,
      sourceFileName,
    );
    const workspaceName = '作業 空間🌹';
    const dateNow = 1_234_567_890;
    const cases = [
      {
        template: '${fileDirname}/${fileBasenameNoExtension}-crop${fileExtname}',
        expectedPath: path.join(path.dirname(sourcePath), `${sourceBaseName}-crop.pdf`),
      },
      {
        template: 'generated/${relativeFileDirname}/${fileBasenameNoExtension} 結果${fileExtname}',
        expectedPath: path.join(workspacePath, 'generated', relativeSourceDirectory, `${sourceBaseName} 結果.pdf`),
      },
      {
        template: '${workspaceFolder}/出力 🌹/${workspaceFolderBasename}/${fileBasename}',
        expectedPath: path.join(workspacePath, '出力 🌹', workspaceName, sourceFileName),
      },
      {
        template: '${fileDirname}/日時-${dateNow}/${fileBasenameNoExtension}-crop.pdf',
        expectedPath: path.join(path.dirname(sourcePath), `日時-${dateNow}`, `${sourceBaseName}-crop.pdf`),
      },
      {
        template: '${file}-crop.pdf',
        expectedPath: `${sourcePath}-crop.pdf`,
      },
      {
        template: 'archive/${relativeFile}',
        expectedPath: path.join(workspacePath, 'archive', relativeSourceDirectory, sourceFileName),
      },
    ];

    const results = await Promise.allSettled(
      cases.map(async ({ template, expectedPath }, index) => {
        const outputPath = resolveOutputPath(template, {
          workspacePath,
          workspaceName,
          sourcePath,
          dateNow,
        });

        assert.strictEqual(outputPath, expectedPath);
        const outputs = await cropPdfWithConfiguredBox({
          job: {
            sourcePath,
            workspacePath,
            outputPath,
            cropBox: {
              left: 0,
              bottom: 0,
              right: 180,
              top: 40,
            },
            target: { type: 'all' },
          },
          runId: `output-path-${index + 1}`,
        });

        assert.strictEqual(outputs[0]?.outputPath, expectedPath);
        await access(expectedPath);
        const document = await PDFDocument.load(await readFile(expectedPath));
        assert.strictEqual(document.getPageCount(), 1);

        return outputPath;
      }),
    );
    const rejectedResults = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.deepStrictEqual(
      rejectedResults.map(({ reason }) => reason),
      [],
    );
    const outputPaths = results.map((result) => {
      assert.strictEqual(result.status, 'fulfilled');
      return result.value;
    });

    assert.deepStrictEqual(
      outputPaths,
      cases.map(({ expectedPath }) => expectedPath),
    );
    assert.strictEqual(path.basename(sourcePath), sourceFileName);
    assert.deepStrictEqual(await readFile(sourcePath), await readFile(inputFixturePath(sourceFixtureFileName)));
  });
});

function inputFixturePath(fileName: string): string {
  return path.join(operationPdfInputDirectory, fileName);
}

async function createTemporaryWorkspace(temporaryDirectories: string[]): Promise<string> {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench crop 作業🌹-'));
  temporaryDirectories.push(workspacePath);
  return workspacePath;
}

async function createTemporaryRenderDirectory(temporaryDirectories: string[]): Promise<string> {
  const renderDirectory = await mkdtemp(path.join(os.tmpdir(), 'graphics-workbench-crop-render-'));
  temporaryDirectories.push(renderDirectory);
  return renderDirectory;
}

async function copyFixtureToWorkspace(
  workspacePath: string,
  fileName: string,
  relativeDirectory: string,
  destinationFileName = fileName,
): Promise<string> {
  const directory = path.join(workspacePath, relativeDirectory);
  const destination = path.join(directory, destinationFileName);
  await mkdir(directory, { recursive: true });
  await copyFile(inputFixturePath(fileName), destination);
  return destination;
}

function assertCropBox(page: PDFPage, cropBox: CropBox): void {
  const expected = {
    x: cropBox.left,
    y: cropBox.bottom,
    width: cropBox.right - cropBox.left,
    height: cropBox.top - cropBox.bottom,
  };

  assert.deepStrictEqual(page.getCropBox(), expected);
}

async function assertRenderedCropMatchesSource(params: {
  sourcePath: string;
  outputPath: string;
  pageNumber: number;
  cropBox: CropBox;
  temporaryDirectory: string;
}): Promise<void> {
  const { sourcePath, outputPath, pageNumber, cropBox, temporaryDirectory } = params;
  const sourceDocument = await PDFDocument.load(await readFile(sourcePath));
  const mediaBox = sourceDocument.getPage(pageNumber - 1).getMediaBox();
  const sourcePngPath = await renderPdfPage(
    sourcePath,
    pageNumber,
    path.join(temporaryDirectory, `source-page-${pageNumber}`),
  );
  const outputPngPath = await renderPdfPage(
    outputPath,
    pageNumber,
    path.join(temporaryDirectory, `output-page-${pageNumber}`),
  );
  const sourceImageBuffer = await readFile(sourcePngPath);
  const sourceImage = sharp(sourceImageBuffer);
  const sourceMetadata = await sourceImage.metadata();

  assert.ok(sourceMetadata.height !== undefined);
  const expectedImage = await sourceImage
    .extract({
      left: Math.round(cropBox.left - mediaBox.x),
      top: sourceMetadata.height - Math.round(cropBox.top - mediaBox.y),
      width: Math.round(cropBox.right - cropBox.left),
      height: Math.round(cropBox.top - cropBox.bottom),
    })
    .png()
    .toBuffer();

  await assertPngsSimilar(expectedImage, await readFile(outputPngPath));
}

async function assertRenderedPagesSimilar(params: {
  expectedPdfPath: string;
  expectedPageNumber: number;
  actualPdfPath: string;
  actualPageNumber: number;
  temporaryDirectory: string;
  prefix: string;
}): Promise<void> {
  const { expectedPdfPath, expectedPageNumber, actualPdfPath, actualPageNumber, temporaryDirectory, prefix } = params;
  const expectedPngPath = await renderPdfPage(
    expectedPdfPath,
    expectedPageNumber,
    path.join(temporaryDirectory, `${prefix}-expected`),
  );
  const actualPngPath = await renderPdfPage(
    actualPdfPath,
    actualPageNumber,
    path.join(temporaryDirectory, `${prefix}-actual`),
  );

  await assertPngsSimilar(await readFile(expectedPngPath), await readFile(actualPngPath));
}

async function renderPdfPage(pdfPath: string, pageNumber: number, outputPrefix: string): Promise<string> {
  const pdftocairoPath = readPdftocairoExecutablePath(getExtensionConfiguration());
  assert.notStrictEqual(pdftocairoPath, '', 'pdftocairo must be configured in test/vscode-settings/settings.json');

  await execFileAsync(pdftocairoPath, [
    '-cropbox',
    '-png',
    '-singlefile',
    '-f',
    pageNumber.toString(),
    '-l',
    pageNumber.toString(),
    '-r',
    '72',
    pdfPath,
    outputPrefix,
  ]);

  return `${outputPrefix}.png`;
}

async function assertPngsSimilar(expectedPng: Buffer, actualPng: Buffer): Promise<void> {
  const [expected, actual] = await Promise.all([
    sharp(expectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(actualPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  assert.strictEqual(actual.info.width, expected.info.width);
  assert.strictEqual(actual.info.height, expected.info.height);
  assert.strictEqual(actual.info.channels, expected.info.channels);

  const exactDifference = calculatePixelDifference(expected, actual, 0, 0);
  const shiftedDifferences = [
    calculatePixelDifference(expected, actual, -1, -1),
    calculatePixelDifference(expected, actual, 0, -1),
    calculatePixelDifference(expected, actual, 1, -1),
    calculatePixelDifference(expected, actual, -1, 0),
    calculatePixelDifference(expected, actual, 1, 0),
    calculatePixelDifference(expected, actual, -1, 1),
    calculatePixelDifference(expected, actual, 0, 1),
    calculatePixelDifference(expected, actual, 1, 1),
  ];
  const closestShiftDifference = Math.min(
    ...shiftedDifferences.map(({ meanChannelDifference }) => meanChannelDifference),
  );

  assert.ok(
    exactDifference.differentPixelRatio <= 0.003,
    `Rendered PDF pixel mismatch ratio was ${exactDifference.differentPixelRatio}.`,
  );
  assert.ok(
    exactDifference.meanChannelDifference <= 0.1,
    `Rendered PDF mean channel difference was ${exactDifference.meanChannelDifference}.`,
  );
  assert.ok(
    exactDifference.meanChannelDifference * 5 < closestShiftDifference,
    `Rendered PDF content is closer to a one-pixel shift (${closestShiftDifference}) than the expected position (${exactDifference.meanChannelDifference}).`,
  );
}

function calculatePixelDifference(
  expected: RawImage,
  actual: RawImage,
  offsetX: number,
  offsetY: number,
): { differentPixelRatio: number; meanChannelDifference: number } {
  let comparedPixels = 0;
  let differentPixels = 0;
  let totalDifference = 0;
  const channels = expected.info.channels;

  for (let expectedY = 0; expectedY < expected.info.height; expectedY += 1) {
    for (let expectedX = 0; expectedX < expected.info.width; expectedX += 1) {
      const actualX = expectedX + offsetX;
      const actualY = expectedY + offsetY;

      if (actualX < 0 || actualY < 0 || actualX >= actual.info.width || actualY >= actual.info.height) {
        continue;
      }

      let maximumChannelDifference = 0;

      for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
        const expectedIndex = (expectedY * expected.info.width + expectedX) * channels + channelIndex;
        const actualIndex = (actualY * actual.info.width + actualX) * channels + channelIndex;
        const difference = Math.abs((expected.data[expectedIndex] ?? 0) - (actual.data[actualIndex] ?? 0));
        maximumChannelDifference = Math.max(maximumChannelDifference, difference);
        totalDifference += difference;
      }

      if (maximumChannelDifference > 8) {
        differentPixels += 1;
      }
      comparedPixels += 1;
    }
  }

  return {
    differentPixelRatio: differentPixels / comparedPixels,
    meanChannelDifference: totalDifference / (comparedPixels * channels),
  };
}

interface RawImage {
  data: Uint8Array;
  info: {
    width: number;
    height: number;
    channels: number;
  };
}
