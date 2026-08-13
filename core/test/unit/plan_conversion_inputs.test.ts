import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { planRasterConversionInputs, rasterFormatSpecs } from '@graphics-workbench/core/conversion';
import { isEditableDrawioImagePath } from '@graphics-workbench/core/formats';
import { buildPdfFixture } from '../helpers/pdf_fixture_builder.js';

const simpleFormats = [
  { spec: rasterFormatSpecs.png, extension: 'png', unsupportedLabel: 'PNG' },
  { spec: rasterFormatSpecs.jpeg, extension: 'jpeg', unsupportedLabel: 'JPEG' },
  { spec: rasterFormatSpecs.avif, extension: 'avif', unsupportedLabel: 'AVIF' },
  { spec: rasterFormatSpecs.tiff, extension: 'tiff', unsupportedLabel: 'TIFF' },
] as const;

const maxInputPixels = 1_000_000_000;

suite(
  'PDFの各ページをラスター変換処理単位（出力パス割当て）へ展開し、同一形式入力は拒否するラスター変換を展開する処理',
  () => {
    for (const { spec, extension, unsupportedLabel } of simpleFormats) {
      test(`${spec.label}変換は2ページのPDFをページごとの変換処理単位へ展開し、各変換処理単位へ${extension}/1.${extension}と${extension}/2.${extension}の出力パスを割り当てる`, async () => {
        await using temporaryDirectory = await mkdtempDisposable(path.join(os.tmpdir(), `gw-plan-${extension}-`));
        const workspacePath = temporaryDirectory.path;

        const sourcePath = path.join(workspacePath, 'source.pdf');
        await writeFile(
          sourcePath,
          await buildPdfFixture([
            { width: 200, height: 150 },
            { width: 200, height: 150 },
          ]),
        );

        const jobs = await planRasterConversionInputs({
          source: {
            sourcePath,
            workspacePath,
            workspaceName: path.basename(workspacePath),
          },
          spec,
          outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.out',
          splitOutputTemplate: `\${fileDirname}/\${fileBasenameNoExtension}/\${page}.${extension}`,
          frameMode: 'first',
          maxInputPixels,
          isEditableDrawioImagePath,
        });

        assert.deepStrictEqual(
          jobs.map(({ sourcePath: jobSourcePath, workspacePath: jobWorkspacePath, outputPath, page }) => ({
            sourcePath: jobSourcePath,
            workspacePath: jobWorkspacePath,
            outputPath,
            page,
          })),
          [
            {
              sourcePath,
              workspacePath,
              outputPath: path.join(workspacePath, 'source', `1.${extension}`),
              page: 1,
            },
            {
              sourcePath,
              workspacePath,
              outputPath: path.join(workspacePath, 'source', `2.${extension}`),
              page: 2,
            },
          ],
        );
      });

      test(`${spec.label}変換で元の形式と同じ拡張子（.${extension}）の入力を渡した場合は変換処理単位を展開せず、同一形式変換としてエラーで拒否する`, async () => {
        await using temporaryDirectory = await mkdtempDisposable(path.join(os.tmpdir(), `gw-plan-${extension}-`));
        const workspacePath = temporaryDirectory.path;
        const sourcePath = path.join(workspacePath, `source.${extension}`);

        await assert.rejects(
          planRasterConversionInputs({
            source: {
              sourcePath,
              workspacePath,
              workspaceName: path.basename(workspacePath),
            },
            spec,
            outputTemplate: '${fileDirname}/${fileBasenameNoExtension}.out',
            splitOutputTemplate: `\${fileDirname}/\${fileBasenameNoExtension}/\${page}.${extension}`,
            frameMode: 'first',
            maxInputPixels,
            isEditableDrawioImagePath,
          }),
          new RegExp(`Unsupported input for ${unsupportedLabel} input: ${RegExp.escape(sourcePath)}`),
        );
      });
    }
  },
);
