import assert from 'node:assert/strict';
import { mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from '../../support/helpers/pdf_document.js';
import * as vscode from 'vscode';

import { rasterFormatSpecs } from '@graphics-workbench/core/operations/conversion/raster_conversion.js';
import { planRasterConversionJobs } from '../../../src/commands/conversion/plan_conversion_jobs.js';
import { getExtensionConfiguration } from '../../../src/config/extension_configuration.js';
import { getDefaultConfiguration } from '../../../src/generated/extension_manifest.js';
import { requireValue } from '../../support/helpers/required.js';

const simpleFormats = [
  { spec: rasterFormatSpecs.png, extension: 'png', unsupportedLabel: 'PNG' },
  { spec: rasterFormatSpecs.jpeg, extension: 'jpeg', unsupportedLabel: 'JPEG' },
  { spec: rasterFormatSpecs.avif, extension: 'avif', unsupportedLabel: 'AVIF' },
  { spec: rasterFormatSpecs.tiff, extension: 'tiff', unsupportedLabel: 'TIFF' },
] as const;

const maxInputPixels = getDefaultConfiguration().raster.maxInputPixels();

suite(
  'PDFの各ページをラスター変換処理単位（出力パス割当て）へ展開し、同一形式入力は拒否するラスター変換を展開する処理',
  () => {
    for (const { spec, extension, unsupportedLabel } of simpleFormats) {
      test(`${spec.label}変換は2ページのPDFをページごとの変換処理単位へ展開し、各変換処理単位へ${extension}/1.${extension}と${extension}/2.${extension}の出力パスを割り当てる`, async () => {
        const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
        await using temporaryDirectory = await mkdtempDisposable(
          path.join(workspace.uri.fsPath, `gw-plan-${extension}-`),
        );

        const sourcePath = path.join(temporaryDirectory.path, 'source.pdf');
        const document = await PDFDocument.create();
        document.addPage([200, 150]);
        document.addPage([200, 150]);
        await writeFile(sourcePath, await document.save());

        const jobs = await planRasterConversionJobs(vscode.Uri.file(sourcePath), spec, {
          configuration: getExtensionConfiguration(),
          maxInputPixels,
        });

        assert.deepStrictEqual(
          jobs.map(({ sourcePath: jobSourcePath, workspacePath, outputPath, page }) => ({
            sourcePath: jobSourcePath,
            workspacePath,
            outputPath,
            page,
          })),
          [
            {
              sourcePath,
              workspacePath: workspace.uri.fsPath,
              outputPath: path.join(temporaryDirectory.path, 'source', `1.${extension}`),
              page: 1,
            },
            {
              sourcePath,
              workspacePath: workspace.uri.fsPath,
              outputPath: path.join(temporaryDirectory.path, 'source', `2.${extension}`),
              page: 2,
            },
          ],
        );
      });

      test(`${spec.label}変換で元の形式と同じ拡張子（.${extension}）の入力を渡した場合は変換処理単位を展開せず、同一形式変換としてエラーで拒否する`, async () => {
        const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
        const sourcePath = path.join(workspace.uri.fsPath, `source.${extension}`);

        await assert.rejects(
          planRasterConversionJobs(vscode.Uri.file(sourcePath), spec, {
            configuration: getExtensionConfiguration(),
            maxInputPixels,
          }),
          new RegExp(`Unsupported input for ${unsupportedLabel} input: ${RegExp.escape(sourcePath)}`),
        );
      });
    }
  },
);
