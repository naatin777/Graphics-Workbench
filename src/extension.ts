import * as vscode from 'vscode';

import type { CommandDependencies } from './commands/shared/command_dependencies.js';
import {
  convertToPdfCommand,
  convertPngToPdfInternalCommand,
  CONVERT_TO_PDF_COMMAND,
  CONVERT_PNG_TO_PDF_COMMAND,
} from './commands/conversion/convert_to_pdf.js';
import {
  convertDrawioToPagePdfsCommand,
  convertDrawioToSinglePdfCommand,
  CONVERT_DRAWIO_TO_PDF_COMMAND,
  CONVERT_DRAWIO_TO_PDF_DIRECTLY_COMMAND,
} from './commands/conversion/convert_drawio_to_pdf.js';
import { convertToAvifCommand, CONVERT_TO_AVIF_COMMAND } from './commands/conversion/convert_to_avif.js';
import { convertToJpegCommand, CONVERT_TO_JPEG_COMMAND } from './commands/conversion/convert_to_jpeg.js';
import { convertToPngCommand, CONVERT_TO_PNG_COMMAND } from './commands/conversion/convert_to_png.js';
import { convertToSvgCommand, CONVERT_TO_SVG_COMMAND } from './commands/conversion/convert_to_svg.js';
import {
  convertToWebpCommand,
  CONVERT_TO_WEBP_COMMAND,
  CONVERT_TO_WEBP_PRESERVE_COMMAND,
  CONVERT_TO_WEBP_SEPARATELY_COMMAND,
} from './commands/conversion/convert_to_webp.js';
import {
  convertToGifCommand,
  CONVERT_TO_GIF_COMMAND,
  CONVERT_TO_GIF_PRESERVE_COMMAND,
  CONVERT_TO_GIF_SEPARATELY_COMMAND,
} from './commands/conversion/convert_to_gif.js';
import { convertToTiffCommand, CONVERT_TO_TIFF_COMMAND } from './commands/conversion/convert_to_tiff.js';
import { convertToEpsCommand, CONVERT_TO_EPS_COMMAND } from './commands/conversion/convert_to_eps.js';
import { convertToRawCommand, CONVERT_TO_RAW_COMMAND } from './commands/conversion/convert_to_raw.js';
import {
  convertToDrawioCommand,
  convertToDrawioPngCommand,
  convertToDrawioSvgCommand,
  CONVERT_TO_DRAWIO_COMMAND,
  CONVERT_TO_DRAWIO_PNG_COMMAND,
  CONVERT_TO_DRAWIO_SVG_COMMAND,
} from './commands/conversion/convert_to_drawio.js';
import {
  combineImagesToPdfCommand,
  COMBINE_IMAGES_TO_PDF_COMMAND,
} from './commands/conversion/combine_images_to_pdf.js';
import { compressPdfCommand, COMPRESS_PDF_COMMAND } from './commands/pdf/compress_pdf.js';
import { cropPdfAutoCommand, CROP_PDF_AUTO_COMMAND } from './commands/pdf/crop_pdf_auto.js';
import { cropPdfConfigureCommand, CROP_PDF_CONFIGURE_COMMAND } from './commands/pdf/crop_pdf_configure.js';
import {
  mergePdfConfigureCommand,
  mergePdfSelectedFilesCommand,
  MERGE_PDF_CONFIGURE_COMMAND,
  MERGE_PDF_SELECTED_FILES_COMMAND,
} from './commands/pdf/merge_pdf.js';
import { initializeSafeMode } from './commands/lifecycle/safe_mode.js';
import {
  splitPdfAllPagesCommand,
  splitPdfConfigureCommand,
  SPLIT_PDF_ALL_PAGES_COMMAND,
  SPLIT_PDF_CONFIGURE_COMMAND,
} from './commands/pdf/split_pdf_commands.js';
import { undoLastConversionCommand, UNDO_LAST_CONVERSION_COMMAND } from './commands/lifecycle/undo_last_conversion.js';
import { LatexDropEditProvider } from './edit_provider/latex_drop_edit_provider.js';
import { LatexPasteEditProvider } from './edit_provider/latex_paste_edit_provider.js';
import { publicCommandIds } from './generated-extension-meta.js';

const latexDocumentSelector: vscode.DocumentSelector = [{ language: 'latex' }, { language: 'tex' }];

export const PUBLIC_COMMAND_IDS = publicCommandIds;

export const INTERNAL_COMMAND_IDS = [CONVERT_PNG_TO_PDF_COMMAND] as const;
export const REGISTERED_COMMAND_IDS = [...PUBLIC_COMMAND_IDS, ...INTERNAL_COMMAND_IDS] as const;

type FileCommandHandler = (uri?: vscode.Uri, uris?: vscode.Uri[]) => Promise<void>;

function registerFileCommand(context: vscode.ExtensionContext, id: string, handler: FileCommandHandler): void {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler));
}

function registerCommands(context: vscode.ExtensionContext, dependencies: CommandDependencies): void {
  registerFileCommand(context, COMPRESS_PDF_COMMAND, async (uri, uris) => compressPdfCommand(uri, uris, dependencies));
  registerFileCommand(context, CROP_PDF_AUTO_COMMAND, async (uri, uris) => cropPdfAutoCommand(uri, uris, dependencies));
  registerFileCommand(context, CROP_PDF_CONFIGURE_COMMAND, async (uri, uris) =>
    cropPdfConfigureCommand(context, uri, uris, dependencies),
  );
  registerFileCommand(context, SPLIT_PDF_ALL_PAGES_COMMAND, async (uri, uris) =>
    splitPdfAllPagesCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, SPLIT_PDF_CONFIGURE_COMMAND, async (uri, uris) =>
    splitPdfConfigureCommand(context, uri, uris, dependencies),
  );
  registerFileCommand(context, MERGE_PDF_SELECTED_FILES_COMMAND, async (uri, uris) =>
    mergePdfSelectedFilesCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, MERGE_PDF_CONFIGURE_COMMAND, async (uri, uris) =>
    mergePdfConfigureCommand(context, uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_PDF_COMMAND, async (uri, uris) =>
    convertToPdfCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_DRAWIO_TO_PDF_COMMAND, async (uri, uris) =>
    convertDrawioToPagePdfsCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_DRAWIO_TO_PDF_DIRECTLY_COMMAND, async (uri, uris) =>
    convertDrawioToSinglePdfCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_PNG_COMMAND, async (uri, uris) =>
    convertToPngCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_JPEG_COMMAND, async (uri, uris) =>
    convertToJpegCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_WEBP_COMMAND, async (uri, uris) =>
    convertToWebpCommand(uri, uris, dependencies, { outputMode: 'auto' }),
  );
  registerFileCommand(context, CONVERT_TO_WEBP_PRESERVE_COMMAND, async (uri, uris) =>
    convertToWebpCommand(uri, uris, dependencies, { outputMode: 'preserve' }),
  );
  registerFileCommand(context, CONVERT_TO_WEBP_SEPARATELY_COMMAND, async (uri, uris) =>
    convertToWebpCommand(uri, uris, dependencies, { outputMode: 'split' }),
  );
  registerFileCommand(context, CONVERT_TO_AVIF_COMMAND, async (uri, uris) =>
    convertToAvifCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_SVG_COMMAND, async (uri, uris) =>
    convertToSvgCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_GIF_COMMAND, async (uri, uris) =>
    convertToGifCommand(uri, uris, dependencies, { outputMode: 'auto' }),
  );
  registerFileCommand(context, CONVERT_TO_GIF_PRESERVE_COMMAND, async (uri, uris) =>
    convertToGifCommand(uri, uris, dependencies, { outputMode: 'preserve' }),
  );
  registerFileCommand(context, CONVERT_TO_GIF_SEPARATELY_COMMAND, async (uri, uris) =>
    convertToGifCommand(uri, uris, dependencies, { outputMode: 'split' }),
  );
  registerFileCommand(context, CONVERT_TO_TIFF_COMMAND, async (uri, uris) =>
    convertToTiffCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_EPS_COMMAND, async (uri, uris) =>
    convertToEpsCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_RAW_COMMAND, async (uri, uris) =>
    convertToRawCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_DRAWIO_COMMAND, async (uri, uris) =>
    convertToDrawioCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_DRAWIO_PNG_COMMAND, async (uri, uris) =>
    convertToDrawioPngCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_TO_DRAWIO_SVG_COMMAND, async (uri, uris) =>
    convertToDrawioSvgCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, COMBINE_IMAGES_TO_PDF_COMMAND, async (uri, uris) =>
    combineImagesToPdfCommand(uri, uris, dependencies),
  );
  registerFileCommand(context, CONVERT_PNG_TO_PDF_COMMAND, async (uri, uris) =>
    convertPngToPdfInternalCommand(uri, uris, dependencies),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(UNDO_LAST_CONVERSION_COMMAND, async (expectedId?: string) =>
      undoLastConversionCommand(expectedId, dependencies),
    ),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  initializeSafeMode(context);
  const outputChannel = vscode.window.createOutputChannel('Graphics Workbench');
  const dependencies = { outputChannel } satisfies CommandDependencies;
  context.subscriptions.push(outputChannel);

  registerCommands(context, dependencies);
  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(latexDocumentSelector, new LatexDropEditProvider(), {
      dropMimeTypes: ['text/uri-list'],
    }),
    vscode.languages.registerDocumentPasteEditProvider(
      latexDocumentSelector,
      new LatexPasteEditProvider({ outputChannel }),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty],
        pasteMimeTypes: ['image/png', 'image/jpeg'],
      },
    ),
  );
}
