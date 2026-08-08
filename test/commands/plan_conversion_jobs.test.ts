import assert from 'node:assert/strict';
import { copyFile, mkdtempDisposable, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import * as vscode from 'vscode';

import { avifSpec, jpegSpec, pngSpec, tiffSpec } from '../../src/commands/conversion/convert_to_raster.js';
import { planRasterConversionJobs } from '../../src/commands/conversion/plan_conversion_jobs.js';
import { configureCommandRuntime } from '../../src/commands/shared/command_runtime.js';
import { getDefaultConfiguration } from '../../src/generated/extension_manifest.js';
import { operationPngInputPath } from '../helpers/fixture_paths.js';
import { requireValue } from '../helpers/required.js';

const simpleFormats = [
  { spec: pngSpec, extension: 'png', unsupportedLabel: 'PNG' },
  { spec: jpegSpec, extension: 'jpeg', unsupportedLabel: 'JPEG' },
  { spec: avifSpec, extension: 'avif', unsupportedLabel: 'AVIF' },
  { spec: tiffSpec, extension: 'tiff', unsupportedLabel: 'TIFF' },
] as const;

const maxInputPixels = getDefaultConfiguration().raster.maxInputPixels();

suite(
  'PDFの各ページをラスター変換処理単位（出力パス割当て）へ展開し、同一形式入力は拒否するラスター変換を展開する処理',
  () => {
    for (const { spec, extension, unsupportedLabel } of simpleFormats) {
      test(`${spec.label}変換は2ページのPDFをページごとの変換処理単位へ展開し、各変換処理単位へsource-1.${extension}とsource-2.${extension}の出力パスを割り当てる`, async () => {
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
          configuration: configureCommandRuntime(),
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
              outputPath: path.join(temporaryDirectory.path, `source-1.${extension}`),
              page: 1,
            },
            {
              sourcePath,
              workspacePath: workspace.uri.fsPath,
              outputPath: path.join(temporaryDirectory.path, `source-2.${extension}`),
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
            configuration: configureCommandRuntime(),
            maxInputPixels,
          }),
          new RegExp(`Unsupported input for ${unsupportedLabel} conversion: ${RegExp.escape(sourcePath)}`),
        );
      });
    }

    test('AVIF変換はPNGのラスター入力をページ1の単一の変換処理単位へ展開し、出力パスsource.avifを割り当てる', async () => {
      const workspace = requireValue(vscode.workspace.workspaceFolders?.[0]);
      await using temporaryDirectory = await mkdtempDisposable(path.join(workspace.uri.fsPath, 'gw-plan-avif-'));

      const sourcePath = path.join(temporaryDirectory.path, 'source.png');
      await copyFile(operationPngInputPath, sourcePath);

      const jobs = await planRasterConversionJobs(vscode.Uri.file(sourcePath), avifSpec, {
        configuration: configureCommandRuntime(),
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
            outputPath: path.join(temporaryDirectory.path, 'source.avif'),
            page: 1,
          },
        ],
      );
    });
  },
);
