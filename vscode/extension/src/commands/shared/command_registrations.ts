import * as vscode from 'vscode';

import type { CommandId } from '../../generated/extension_manifest.js';
import { compressPdfCommand } from '../pdf/compress_pdf.js';
import { cropPdfAutoCommand } from '../pdf/crop_pdf_auto.js';
import { cropPdfConfigureCommand } from '../pdf/crop_pdf_configure.js';
import { decryptPdfCommand } from '../pdf/decrypt_pdf.js';
import { encryptPdfCommand } from '../pdf/encrypt_pdf.js';
import { mergePdfConfigureCommand, mergePdfSelectedFilesCommand } from '../pdf/merge_pdf.js';
import { reorderPdfConfigureCommand } from '../pdf/reorder_pdf_configure.js';
import { rotatePdfCommand } from '../pdf/rotate_pdf.js';
import { rotatePdfConfigureCommand } from '../pdf/rotate_pdf_configure.js';
import { splitPdfAllPagesCommand, splitPdfConfigureCommand } from '../pdf/split_pdf_commands.js';
import { combineImagesToPdfCommand, quickCombineImagesToPdfCommand } from '../conversion/combine_images_to_pdf.js';
import { compressImageCommand } from '../conversion/compress_image.js';
import {
  convertDrawioToPagePdfsCommand,
  convertDrawioToSinglePdfCommand,
} from '../conversion/convert_drawio_to_pdf.js';
import {
  convertToDrawioCommand,
  convertToDrawioPngCommand,
  convertToDrawioSvgCommand,
} from '../conversion/convert_to_drawio.js';
import { convertToPdfCommand } from '../conversion/convert_to_pdf.js';
import { convertToRasterCommand, type ConvertToRasterCommandOptions } from '../conversion/convert_to_raster.js';
import { convertToSvgCommand } from '../conversion/convert_to_svg.js';
import { rotateImageCommand } from '../conversion/rotate_image.js';
import { openControlsPanelCommand } from '../lifecycle/controls_panel.js';
import { toggleSafeModeCommand } from '../lifecycle/safe_mode.js';
import { undoLastConversionCommand } from '../lifecycle/undo_last_conversion.js';
import { openTableEditorCommand } from '../table/open_table_editor.js';
import type { CommandDependencies } from './command_dependencies.js';
import { resolveSelectedUris } from './command_input.js';

type FileCommandHandler = (sourceUris: vscode.Uri[], dependencies: CommandDependencies) => Promise<void>;

type FileWithContextCommandHandler = (
  context: vscode.ExtensionContext,
  sourceUris: vscode.Uri[],
  dependencies: CommandDependencies,
) => Promise<void>;

// oxlint-disable-next-line typescript/no-restricted-types -- VS Codeが渡すコマンド引数は未検証の外部境界。
type ExtensionCommandHandler = (dependencies: CommandDependencies, ...args: unknown[]) => Promise<void>;

/** VS Codeから(uri, uris)入力を受けるファイル系コマンドを登録する。 */
export function registerFileCommand(
  context: vscode.ExtensionContext,
  id: CommandId,
  handler: FileCommandHandler,
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      return handler(resolveSelectedUris(uri, uris), dependencies);
    }),
  );
}

/** ExtensionContextも必要なconfigure系コマンドを登録する。 */
export function registerFileWithContextCommand(
  context: vscode.ExtensionContext,
  id: CommandId,
  handler: FileWithContextCommandHandler,
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      return handler(context, resolveSelectedUris(uri, uris), dependencies);
    }),
  );
}

/** VS Codeが任意引数で呼ぶライフサイクル系コマンドを登録する。 */
export function registerExtensionCommand(
  context: vscode.ExtensionContext,
  id: CommandId,
  handler: ExtensionCommandHandler,
  dependencies: CommandDependencies,
): void {
  context.subscriptions.push(
    // oxlint-disable-next-line typescript/no-restricted-types -- VS Codeが渡すコマンド引数は未検証の外部境界。
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      return handler(dependencies, ...args);
    }),
  );
}

/** ラスタ変換コマンドは変換ターゲットとアニメーション入力モードをoptionsで指定する。 */
export function registerRasterCommand(
  context: vscode.ExtensionContext,
  id: CommandId,
  options: ConvertToRasterCommandOptions,
  dependencies: CommandDependencies,
): void {
  registerFileCommand(
    context,
    id,
    async (sourceUris, commandDependencies) => {
      await convertToRasterCommand(sourceUris, commandDependencies, options);
    },
    dependencies,
  );
}

export function registerCommands(context: vscode.ExtensionContext, dependencies: CommandDependencies): void {
  // PDF
  registerFileCommand(context, 'graphics-workbench.compressPdf', compressPdfCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.encryptPdf', encryptPdfCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.decryptPdf', decryptPdfCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.rotatePdf.rotate', rotatePdfCommand, dependencies);
  registerFileWithContextCommand(
    context,
    'graphics-workbench.rotatePdf.configure',
    rotatePdfConfigureCommand,
    dependencies,
  );
  registerFileWithContextCommand(
    context,
    'graphics-workbench.reorderPdf.configure',
    reorderPdfConfigureCommand,
    dependencies,
  );
  registerFileCommand(context, 'graphics-workbench.cropPdf.auto', cropPdfAutoCommand, dependencies);
  registerFileWithContextCommand(
    context,
    'graphics-workbench.cropPdf.configure',
    cropPdfConfigureCommand,
    dependencies,
  );
  registerFileCommand(context, 'graphics-workbench.splitPdf.allPages', splitPdfAllPagesCommand, dependencies);
  registerFileWithContextCommand(
    context,
    'graphics-workbench.splitPdf.configure',
    splitPdfConfigureCommand,
    dependencies,
  );
  registerFileCommand(context, 'graphics-workbench.mergePdf.selectedFiles', mergePdfSelectedFilesCommand, dependencies);
  registerFileWithContextCommand(
    context,
    'graphics-workbench.mergePdf.configure',
    mergePdfConfigureCommand,
    dependencies,
  );
  // Conversion
  registerFileCommand(context, 'graphics-workbench.convertToPdf', convertToPdfCommand, dependencies);
  registerFileCommand(
    context,
    'graphics-workbench.convertDrawioToPagePdfs',
    convertDrawioToPagePdfsCommand,
    dependencies,
  );
  registerFileCommand(
    context,
    'graphics-workbench.convertDrawioToSinglePdf',
    convertDrawioToSinglePdfCommand,
    dependencies,
  );
  registerRasterCommand(context, 'graphics-workbench.convertToPng', { target: 'png' }, dependencies);
  registerRasterCommand(context, 'graphics-workbench.convertToJpeg', { target: 'jpeg' }, dependencies);
  registerRasterCommand(context, 'graphics-workbench.convertToWebp', { target: 'webp' }, dependencies);
  registerRasterCommand(
    context,
    'graphics-workbench.convertToWebpSplit',
    { target: 'webp', animatedInputMode: 'split' },
    dependencies,
  );
  registerRasterCommand(context, 'graphics-workbench.convertToAvif', { target: 'avif' }, dependencies);
  registerFileCommand(context, 'graphics-workbench.convertToSvg', convertToSvgCommand, dependencies);
  registerRasterCommand(context, 'graphics-workbench.convertToGif', { target: 'gif' }, dependencies);
  registerRasterCommand(
    context,
    'graphics-workbench.convertToGifSplit',
    { target: 'gif', animatedInputMode: 'split' },
    dependencies,
  );
  registerRasterCommand(context, 'graphics-workbench.convertToTiff', { target: 'tiff' }, dependencies);
  registerFileCommand(context, 'graphics-workbench.convertToDrawio', convertToDrawioCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.convertToDrawioPng', convertToDrawioPngCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.convertToDrawioSvg', convertToDrawioSvgCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.combineImagesToPdf', combineImagesToPdfCommand, dependencies);
  registerFileCommand(
    context,
    'graphics-workbench.quickCombineImagesToPdf',
    quickCombineImagesToPdfCommand,
    dependencies,
  );
  registerFileCommand(context, 'graphics-workbench.rotateImage', rotateImageCommand, dependencies);
  registerFileCommand(context, 'graphics-workbench.compressImage', compressImageCommand, dependencies);
  // Lifecycle
  registerExtensionCommand(
    context,
    'graphics-workbench.undoLastConversion',
    async (commandDependencies, ...args) =>
      undoLastConversionCommand(typeof args[0] === 'string' ? args[0] : undefined, commandDependencies),
    dependencies,
  );
  registerExtensionCommand(
    context,
    'graphics-workbench.toggleSafeMode',
    async () => toggleSafeModeCommand(),
    dependencies,
  );
  registerExtensionCommand(context, 'graphics-workbench.openControls', openControlsPanelCommand, dependencies);
  // Table editor
  registerExtensionCommand(context, 'graphics-workbench.openTableEditor', openTableEditorCommand, dependencies);
}
