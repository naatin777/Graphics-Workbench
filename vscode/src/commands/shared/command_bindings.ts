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
import type * as vscode from 'vscode';

/** VS Codeから(uri, uris)入力を受けるファイル系コマンド。 */
export interface FileCommandBinding {
  kind: 'file';
  id: CommandId;
  handler: (
    sourceUris: vscode.Uri[],
    dependencies: CommandDependencies,
    options?: ConvertToRasterCommandOptions,
  ) => Promise<void>;
  /** ラスタ変換など固定optionsをhandlerへ渡すbindingのみ保持。 */
  options?: ConvertToRasterCommandOptions;
}

/** VS Codeから(uri, uris)入力を受け、ExtensionContextも必要なconfigure系コマンド。 */
export interface FileWithContextCommandBinding {
  kind: 'fileWithContext';
  id: CommandId;
  handler: (
    context: vscode.ExtensionContext,
    sourceUris: vscode.Uri[],
    dependencies: CommandDependencies,
  ) => Promise<void>;
}

/** VS Codeが任意引数で呼ぶライフサイクル系コマンド。 */
export interface ExtensionCommandBinding {
  kind: 'extensionCommand';
  id: CommandId;
  // oxlint-disable-next-line typescript/no-restricted-types -- VS Codeから渡されるコマンド引数は未検証の外部境界。
  handler: (dependencies: CommandDependencies, ...args: unknown[]) => Promise<void>;
}

export type CommandBinding = FileCommandBinding | FileWithContextCommandBinding | ExtensionCommandBinding;

function fileBinding(id: CommandId, handler: FileCommandBinding['handler']): FileCommandBinding {
  return { kind: 'file', id, handler };
}

function fileWithContextBinding(
  id: CommandId,
  handler: FileWithContextCommandBinding['handler'],
): FileWithContextCommandBinding {
  return { kind: 'fileWithContext', id, handler };
}

function extensionCommandBinding(id: CommandId, handler: ExtensionCommandBinding['handler']): ExtensionCommandBinding {
  return { kind: 'extensionCommand', id, handler };
}

/** ラスタ変換コマンドは変換ターゲットとcardinalityをoptionsで指定する。 */
function rasterFileBinding(
  id: CommandId,
  target: 'png' | 'jpeg' | 'avif' | 'tiff' | 'webp' | 'gif',
  cardinality?: 'single' | 'split',
): FileCommandBinding {
  return {
    kind: 'file',
    id,
    handler: convertToRasterCommand,
    options: { target, ...(cardinality !== undefined && { cardinality }) },
  };
}

export const commandBindings = [
  // PDF
  fileBinding('graphics-workbench.compressPdf', compressPdfCommand),
  fileBinding('graphics-workbench.encryptPdf', encryptPdfCommand),
  fileBinding('graphics-workbench.decryptPdf', decryptPdfCommand),
  fileBinding('graphics-workbench.rotatePdf.rotate', rotatePdfCommand),
  fileWithContextBinding('graphics-workbench.rotatePdf.configure', rotatePdfConfigureCommand),
  fileWithContextBinding('graphics-workbench.reorderPdf.configure', reorderPdfConfigureCommand),
  fileBinding('graphics-workbench.cropPdf.auto', cropPdfAutoCommand),
  fileWithContextBinding('graphics-workbench.cropPdf.configure', cropPdfConfigureCommand),
  fileBinding('graphics-workbench.splitPdf.allPages', splitPdfAllPagesCommand),
  fileWithContextBinding('graphics-workbench.splitPdf.configure', splitPdfConfigureCommand),
  fileBinding('graphics-workbench.mergePdf.selectedFiles', mergePdfSelectedFilesCommand),
  fileWithContextBinding('graphics-workbench.mergePdf.configure', mergePdfConfigureCommand),
  // Conversion
  fileBinding('graphics-workbench.convertToPdf', convertToPdfCommand),
  fileBinding('graphics-workbench.convertDrawioToPagePdfs', convertDrawioToPagePdfsCommand),
  fileBinding('graphics-workbench.convertDrawioToSinglePdf', convertDrawioToSinglePdfCommand),
  // excalidraw変換はjsdom依存のため遅延import（起動時に重いjsdomを読み込まない）
  {
    kind: 'file',
    id: 'graphics-workbench.convertExcalidrawToPdf',
    handler: async (sourceUris, dependencies) => {
      const { convertExcalidrawToPdfCommand } = await import('../conversion/convert_excalidraw_to_pdf.js');
      return convertExcalidrawToPdfCommand(sourceUris, dependencies);
    },
  },
  rasterFileBinding('graphics-workbench.convertToPng', 'png'),
  rasterFileBinding('graphics-workbench.convertToJpeg', 'jpeg'),
  rasterFileBinding('graphics-workbench.convertToWebp', 'webp'),
  rasterFileBinding('graphics-workbench.convertToWebpPreserveAnimation', 'webp'),
  rasterFileBinding('graphics-workbench.convertToWebpSeparately', 'webp', 'split'),
  rasterFileBinding('graphics-workbench.convertToAvif', 'avif'),
  fileBinding('graphics-workbench.convertToSvg', convertToSvgCommand),
  rasterFileBinding('graphics-workbench.convertToGif', 'gif'),
  rasterFileBinding('graphics-workbench.convertToGifPreserveAnimation', 'gif'),
  rasterFileBinding('graphics-workbench.convertToGifSeparately', 'gif', 'split'),
  rasterFileBinding('graphics-workbench.convertToTiff', 'tiff'),
  fileBinding('graphics-workbench.convertToDrawio', convertToDrawioCommand),
  fileBinding('graphics-workbench.convertToDrawioPng', convertToDrawioPngCommand),
  fileBinding('graphics-workbench.convertToDrawioSvg', convertToDrawioSvgCommand),
  fileBinding('graphics-workbench.combineImagesToPdf', combineImagesToPdfCommand),
  fileBinding('graphics-workbench.quickCombineImagesToPdf', quickCombineImagesToPdfCommand),
  fileBinding('graphics-workbench.rotateImage', rotateImageCommand),
  fileBinding('graphics-workbench.compressImage', compressImageCommand),
  // Lifecycle
  extensionCommandBinding('graphics-workbench.undoLastConversion', async (dependencies, ...args) =>
    undoLastConversionCommand(typeof args[0] === 'string' ? args[0] : undefined, dependencies),
  ),
  extensionCommandBinding('graphics-workbench.toggleSafeMode', async () => toggleSafeModeCommand()),
  extensionCommandBinding('graphics-workbench.openControls', openControlsPanelCommand),
  // Table editor
  extensionCommandBinding('graphics-workbench.openTableEditor', openTableEditorCommand),
] as const satisfies readonly CommandBinding[];
