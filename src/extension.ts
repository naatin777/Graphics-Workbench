import * as vscode from 'vscode';

import type { LineOutputChannel } from './operations/external_tools/external_tool_ascii_scratch.js';
import type { CommandDependencies } from './commands/shared/command_dependencies.js';
import { initializeSafeMode } from './commands/lifecycle/safe_mode.js';
import { initializeUndoHistory, undoLastConversionCommand } from './commands/lifecycle/undo_last_conversion.js';
import { LatexDropEditProvider } from './edit_provider/latex_drop_edit_provider.js';
import { LatexPasteEditProvider } from './edit_provider/latex_paste_edit_provider.js';
import { getExtensionConfiguration } from './generated-extension-config.js';
import { publicCommandIds, type CommandId } from './generated-extension-meta.js';

const latexDocumentSelector: vscode.DocumentSelector = [{ language: 'latex' }, { language: 'tex' }];

export const PUBLIC_COMMAND_IDS = publicCommandIds;

export const INTERNAL_COMMAND_IDS = ['graphics-workbench.convertPngToPdf'] as const;
export const REGISTERED_COMMAND_IDS = [...PUBLIC_COMMAND_IDS, ...INTERNAL_COMMAND_IDS] as const;

type FileCommandHandler = (uri?: vscode.Uri, uris?: vscode.Uri[]) => Promise<void>;

function registerFileCommand(context: vscode.ExtensionContext, id: CommandId, handler: FileCommandHandler): void {
  context.subscriptions.push(vscode.commands.registerCommand(id, handler));
}

const loadedCommandModules = new Set<string>();

/** Loads a lazily imported command module and records its first-load duration. */
async function loadCommandModule<T>(
  outputChannel: LineOutputChannel,
  specifier: string,
  load: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const module = await load();

  if (!loadedCommandModules.has(specifier)) {
    loadedCommandModules.add(specifier);
    outputChannel.appendLine(`[load] ${specifier} first load ${Date.now() - startedAt}ms`);
  }

  return module;
}

function registerCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
  outputChannel: LineOutputChannel,
): void {
  registerFileCommand(context, 'graphics-workbench.compressPdf', async (uri, uris) => {
    const { compressPdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/compress_pdf.js',
      async () => import('./commands/pdf/compress_pdf.js'),
    );
    return compressPdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.linearizePdf', async (uri, uris) => {
    const { linearizePdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/linearize_pdf.js',
      async () => import('./commands/pdf/linearize_pdf.js'),
    );
    return linearizePdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.encryptPdf', async (uri, uris) => {
    const { encryptPdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/encrypt_pdf.js',
      async () => import('./commands/pdf/encrypt_pdf.js'),
    );
    return encryptPdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.cropPdf.auto', async (uri, uris) => {
    const { cropPdfAutoCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/crop_pdf_auto.js',
      async () => import('./commands/pdf/crop_pdf_auto.js'),
    );
    return cropPdfAutoCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.cropPdf.configure', async (uri, uris) => {
    const { cropPdfConfigureCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/crop_pdf_configure.js',
      async () => import('./commands/pdf/crop_pdf_configure.js'),
    );
    return cropPdfConfigureCommand(context, uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.splitPdf.allPages', async (uri, uris) => {
    const { splitPdfAllPagesCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/split_pdf_commands.js',
      async () => import('./commands/pdf/split_pdf_commands.js'),
    );
    return splitPdfAllPagesCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.splitPdf.configure', async (uri, uris) => {
    const { splitPdfConfigureCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/split_pdf_commands.js',
      async () => import('./commands/pdf/split_pdf_commands.js'),
    );
    return splitPdfConfigureCommand(context, uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.mergePdf.selectedFiles', async (uri, uris) => {
    const { mergePdfSelectedFilesCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/merge_pdf.js',
      async () => import('./commands/pdf/merge_pdf.js'),
    );
    return mergePdfSelectedFilesCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.mergePdf.configure', async (uri, uris) => {
    const { mergePdfConfigureCommand } = await loadCommandModule(
      outputChannel,
      './commands/pdf/merge_pdf.js',
      async () => import('./commands/pdf/merge_pdf.js'),
    );
    return mergePdfConfigureCommand(context, uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToPdf', async (uri, uris) => {
    const { convertToPdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_pdf.js',
      async () => import('./commands/conversion/convert_to_pdf.js'),
    );
    return convertToPdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertDrawioToPdf', async (uri, uris) => {
    const { convertDrawioToPagePdfsCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_drawio_to_pdf.js',
      async () => import('./commands/conversion/convert_drawio_to_pdf.js'),
    );
    return convertDrawioToPagePdfsCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertDrawioToPdfDirectly', async (uri, uris) => {
    const { convertDrawioToSinglePdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_drawio_to_pdf.js',
      async () => import('./commands/conversion/convert_drawio_to_pdf.js'),
    );
    return convertDrawioToSinglePdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToPng', async (uri, uris) => {
    const { convertToPngCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_png.js',
      async () => import('./commands/conversion/convert_to_png.js'),
    );
    return convertToPngCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToJpeg', async (uri, uris) => {
    const { convertToJpegCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_jpeg.js',
      async () => import('./commands/conversion/convert_to_jpeg.js'),
    );
    return convertToJpegCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToWebp', async (uri, uris) => {
    const { convertToWebpCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_webp.js',
      async () => import('./commands/conversion/convert_to_webp.js'),
    );
    return convertToWebpCommand(uri, uris, dependencies, { outputMode: 'auto' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToWebpPreserveAnimation', async (uri, uris) => {
    const { convertToWebpCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_webp.js',
      async () => import('./commands/conversion/convert_to_webp.js'),
    );
    return convertToWebpCommand(uri, uris, dependencies, { outputMode: 'preserve' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToWebpSeparately', async (uri, uris) => {
    const { convertToWebpCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_webp.js',
      async () => import('./commands/conversion/convert_to_webp.js'),
    );
    return convertToWebpCommand(uri, uris, dependencies, { outputMode: 'split' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToAvif', async (uri, uris) => {
    const { convertToAvifCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_avif.js',
      async () => import('./commands/conversion/convert_to_avif.js'),
    );
    return convertToAvifCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToSvg', async (uri, uris) => {
    const { convertToSvgCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_svg.js',
      async () => import('./commands/conversion/convert_to_svg.js'),
    );
    return convertToSvgCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToGif', async (uri, uris) => {
    const { convertToGifCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_gif.js',
      async () => import('./commands/conversion/convert_to_gif.js'),
    );
    return convertToGifCommand(uri, uris, dependencies, { outputMode: 'auto' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToGifPreserveAnimation', async (uri, uris) => {
    const { convertToGifCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_gif.js',
      async () => import('./commands/conversion/convert_to_gif.js'),
    );
    return convertToGifCommand(uri, uris, dependencies, { outputMode: 'preserve' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToGifSeparately', async (uri, uris) => {
    const { convertToGifCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_gif.js',
      async () => import('./commands/conversion/convert_to_gif.js'),
    );
    return convertToGifCommand(uri, uris, dependencies, { outputMode: 'split' });
  });
  registerFileCommand(context, 'graphics-workbench.convertToTiff', async (uri, uris) => {
    const { convertToTiffCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_tiff.js',
      async () => import('./commands/conversion/convert_to_tiff.js'),
    );
    return convertToTiffCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToEps', async (uri, uris) => {
    const { convertToEpsCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_eps.js',
      async () => import('./commands/conversion/convert_to_eps.js'),
    );
    return convertToEpsCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToDrawio', async (uri, uris) => {
    const { convertToDrawioCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_drawio.js',
      async () => import('./commands/conversion/convert_to_drawio.js'),
    );
    return convertToDrawioCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToDrawioPng', async (uri, uris) => {
    const { convertToDrawioPngCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_drawio.js',
      async () => import('./commands/conversion/convert_to_drawio.js'),
    );
    return convertToDrawioPngCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertToDrawioSvg', async (uri, uris) => {
    const { convertToDrawioSvgCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_drawio.js',
      async () => import('./commands/conversion/convert_to_drawio.js'),
    );
    return convertToDrawioSvgCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertImagesToSinglePdf', async (uri, uris) => {
    const { combineImagesToPdfCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/combine_images_to_pdf.js',
      async () => import('./commands/conversion/combine_images_to_pdf.js'),
    );
    return combineImagesToPdfCommand(uri, uris, dependencies);
  });
  registerFileCommand(context, 'graphics-workbench.convertPngToPdf', async (uri, uris) => {
    const { convertPngToPdfInternalCommand } = await loadCommandModule(
      outputChannel,
      './commands/conversion/convert_to_pdf.js',
      async () => import('./commands/conversion/convert_to_pdf.js'),
    );
    return convertPngToPdfInternalCommand(uri, uris, dependencies);
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('graphics-workbench.undoLastConversion', async (expectedId?: string) =>
      undoLastConversionCommand(expectedId, dependencies),
    ),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activatedAt = Date.now();
  initializeSafeMode(context);
  const outputChannel = vscode.window.createOutputChannel('Graphics Workbench');
  initializeUndoHistory({ workspaceState: context.workspaceState, outputChannel });
  const dependencies = { getConfiguration: getExtensionConfiguration, outputChannel } satisfies CommandDependencies;
  context.subscriptions.push(outputChannel);

  registerCommands(context, dependencies, outputChannel);
  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(latexDocumentSelector, new LatexDropEditProvider(), {
      dropMimeTypes: ['text/uri-list'],
    }),
    vscode.languages.registerDocumentPasteEditProvider(
      latexDocumentSelector,
      new LatexPasteEditProvider({ getConfiguration: getExtensionConfiguration, outputChannel }),
      {
        providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty],
        pasteMimeTypes: ['image/png', 'image/jpeg'],
      },
    ),
  );

  outputChannel.appendLine(`[activation] extension activated in ${Date.now() - activatedAt}ms`);
}
