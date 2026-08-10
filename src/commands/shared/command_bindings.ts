import type { CommandId } from '../../generated/extension_manifest.js';

/**
 * コマンド実装の呼び出し形の種類。
 *
 * 各adapterはbindingのmodule/exportNameをlazy loadし、固定された引数へ変換して呼び出す。
 * 新しい呼び出し形が必要な場合だけadapterを追加し、自由なコード文字列は受け付けない。
 */
type CommandAdapter = 'file' | 'fileWithContext' | 'extensionCommand';

export interface CommandBinding {
  /** package.json の contributes.commands に存在するpublic command ID。 */
  id: CommandId;
  /** dynamic import先のmodule path（command_registrations.tsからの相対）。 */
  module: string;
  /** moduleから取得するexport名。 */
  exportName: string;
  adapter: CommandAdapter;
  /** fileWithOptions adapterへ渡す固定options。 */
  options?: unknown;
}

export const commandBindings = [
  // PDF
  {
    id: 'graphics-workbench.compressPdf',
    module: '../pdf/compress_pdf.js',
    exportName: 'compressPdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.encryptPdf',
    module: '../pdf/encrypt_pdf.js',
    exportName: 'encryptPdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.decryptPdf',
    module: '../pdf/decrypt_pdf.js',
    exportName: 'decryptPdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.rotatePdf.rotate',
    module: '../pdf/rotate_pdf.js',
    exportName: 'rotatePdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.rotatePdf.configure',
    module: '../pdf/rotate_pdf_configure.js',
    exportName: 'rotatePdfConfigureCommand',
    adapter: 'fileWithContext',
  },
  {
    id: 'graphics-workbench.reorderPdf.configure',
    module: '../pdf/reorder_pdf_configure.js',
    exportName: 'reorderPdfConfigureCommand',
    adapter: 'fileWithContext',
  },
  {
    id: 'graphics-workbench.cropPdf.auto',
    module: '../pdf/crop_pdf_auto.js',
    exportName: 'cropPdfAutoCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.cropPdf.configure',
    module: '../pdf/crop_pdf_configure.js',
    exportName: 'cropPdfConfigureCommand',
    adapter: 'fileWithContext',
  },
  {
    id: 'graphics-workbench.splitPdf.allPages',
    module: '../pdf/split_pdf_commands.js',
    exportName: 'splitPdfAllPagesCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.splitPdf.configure',
    module: '../pdf/split_pdf_commands.js',
    exportName: 'splitPdfConfigureCommand',
    adapter: 'fileWithContext',
  },
  {
    id: 'graphics-workbench.mergePdf.selectedFiles',
    module: '../pdf/merge_pdf.js',
    exportName: 'mergePdfSelectedFilesCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.mergePdf.configure',
    module: '../pdf/merge_pdf.js',
    exportName: 'mergePdfConfigureCommand',
    adapter: 'fileWithContext',
  },
  // Conversion
  {
    id: 'graphics-workbench.convertToPdf',
    module: '../conversion/convert_to_pdf.js',
    exportName: 'convertToPdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertDrawioToPagePdfs',
    module: '../conversion/convert_drawio_to_pdf.js',
    exportName: 'convertDrawioToPagePdfsCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertDrawioToSinglePdf',
    module: '../conversion/convert_drawio_to_pdf.js',
    exportName: 'convertDrawioToSinglePdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertExcalidrawToPdf',
    module: '../conversion/convert_excalidraw_to_pdf.js',
    exportName: 'convertExcalidrawToPdfCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertToPng',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'png' },
  },
  {
    id: 'graphics-workbench.convertToJpeg',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'jpeg' },
  },
  {
    id: 'graphics-workbench.convertToWebp',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'webp', outputMode: 'auto' },
  },
  {
    id: 'graphics-workbench.convertToWebpPreserveAnimation',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'webp', outputMode: 'preserve' },
  },
  {
    id: 'graphics-workbench.convertToWebpSeparately',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'webp', outputMode: 'split' },
  },
  {
    id: 'graphics-workbench.convertToAvif',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'avif' },
  },
  {
    id: 'graphics-workbench.convertToSvg',
    module: '../conversion/convert_to_svg.js',
    exportName: 'convertToSvgCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertToGif',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'gif', outputMode: 'auto' },
  },
  {
    id: 'graphics-workbench.convertToGifPreserveAnimation',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'gif', outputMode: 'preserve' },
  },
  {
    id: 'graphics-workbench.convertToGifSeparately',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'gif', outputMode: 'split' },
  },
  {
    id: 'graphics-workbench.convertToTiff',
    module: '../conversion/convert_to_raster.js',
    exportName: 'convertToRasterCommand',
    adapter: 'file',
    options: { target: 'tiff' },
  },
  {
    id: 'graphics-workbench.convertToDrawio',
    module: '../conversion/convert_to_drawio.js',
    exportName: 'convertToDrawioCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertToDrawioPng',
    module: '../conversion/convert_to_drawio.js',
    exportName: 'convertToDrawioPngCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.convertToDrawioSvg',
    module: '../conversion/convert_to_drawio.js',
    exportName: 'convertToDrawioSvgCommand',
    adapter: 'file',
  },
  {
    id: 'graphics-workbench.combineImagesToPdf',
    module: '../conversion/combine_images_to_pdf.js',
    exportName: 'combineImagesToPdfCommand',
    adapter: 'file',
  },
  // Lifecycle
  {
    id: 'graphics-workbench.undoLastConversion',
    module: '../lifecycle/undo_last_conversion.js',
    exportName: 'undoLastConversionCommand',
    adapter: 'extensionCommand',
  },
  {
    id: 'graphics-workbench.toggleSafeMode',
    module: '../lifecycle/safe_mode.js',
    exportName: 'toggleSafeModeCommand',
    adapter: 'extensionCommand',
  },
  {
    id: 'graphics-workbench.openControls',
    module: '../lifecycle/controls_panel.js',
    exportName: 'openControlsPanelCommand',
    adapter: 'extensionCommand',
  },
] as const satisfies readonly CommandBinding[];
