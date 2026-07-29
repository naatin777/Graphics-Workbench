import * as vscode from 'vscode';

import { configs as configGetters } from './generated-extension-meta.js';

export function getExtensionConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('graphics-workbench');
}

const configuration = getExtensionConfiguration();

export const configs = {
  execPath: {
    drawio: () => configGetters.execPath.drawio(configuration),
    ghostscript: () => configGetters.execPath.ghostscript(configuration),
    pdftocairo: () => configGetters.execPath.pdftocairo(configuration),
    rsvgConvert: () => configGetters.execPath.rsvgConvert(configuration),
  },
  raster: {
    maxInputPixels: () => configGetters.raster.maxInputPixels(configuration),
  },
  convertToPdf: {
    svg: {
      engine: () => configGetters.convertToPdf.svg.engine(configuration),
    },
  },
  mermaid: {
    theme: () => configGetters.mermaid.theme(configuration),
    backgroundColor: () => configGetters.mermaid.backgroundColor(configuration),
  },
  insertLatex: {
    pdfTemplate: () => configGetters.insertLatex.pdfTemplate(configuration),
    imageTemplate: () => configGetters.insertLatex.imageTemplate(configuration),
  },
  puppeteer: {
    executablePath: () => configGetters.puppeteer.executablePath(configuration),
    browser: () => configGetters.puppeteer.browser(configuration),
  },
  convertToWebp: {
    effort: () => configGetters.convertToWebp.effort(configuration),
  },
  convertToAvif: {
    effort: () => configGetters.convertToAvif.effort(configuration),
  },
  outputPath: {
    cropPdf: () => configGetters.outputPath.cropPdf(configuration),
    splitPdf: () => configGetters.outputPath.splitPdf(configuration),
    convertPngToPdf: () => configGetters.outputPath.convertPngToPdf(configuration),
    convertJpegToPdf: () => configGetters.outputPath.convertJpegToPdf(configuration),
    convertWebpToPdf: () => configGetters.outputPath.convertWebpToPdf(configuration),
    convertAvifToPdf: () => configGetters.outputPath.convertAvifToPdf(configuration),
    convertSvgToPdf: () => configGetters.outputPath.convertSvgToPdf(configuration),
    convertMermaidToPdf: () => configGetters.outputPath.convertMermaidToPdf(configuration),
    convertPngToJpeg: () => configGetters.outputPath.convertPngToJpeg(configuration),
    convertPngToWebp: () => configGetters.outputPath.convertPngToWebp(configuration),
    convertPngToAvif: () => configGetters.outputPath.convertPngToAvif(configuration),
    convertJpegToPng: () => configGetters.outputPath.convertJpegToPng(configuration),
    convertJpegToWebp: () => configGetters.outputPath.convertJpegToWebp(configuration),
    convertJpegToAvif: () => configGetters.outputPath.convertJpegToAvif(configuration),
    convertWebpToPng: () => configGetters.outputPath.convertWebpToPng(configuration),
    convertWebpToJpeg: () => configGetters.outputPath.convertWebpToJpeg(configuration),
    convertWebpToAvif: () => configGetters.outputPath.convertWebpToAvif(configuration),
    convertAvifToPng: () => configGetters.outputPath.convertAvifToPng(configuration),
    convertAvifToJpeg: () => configGetters.outputPath.convertAvifToJpeg(configuration),
    convertAvifToWebp: () => configGetters.outputPath.convertAvifToWebp(configuration),
    convertSvgToPng: () => configGetters.outputPath.convertSvgToPng(configuration),
    convertSvgToJpeg: () => configGetters.outputPath.convertSvgToJpeg(configuration),
    convertSvgToWebp: () => configGetters.outputPath.convertSvgToWebp(configuration),
    convertSvgToAvif: () => configGetters.outputPath.convertSvgToAvif(configuration),
    convertMermaidToSvg: () => configGetters.outputPath.convertMermaidToSvg(configuration),
    convertMermaidToPng: () => configGetters.outputPath.convertMermaidToPng(configuration),
    convertMermaidToJpeg: () => configGetters.outputPath.convertMermaidToJpeg(configuration),
    convertMermaidToWebp: () => configGetters.outputPath.convertMermaidToWebp(configuration),
    convertMermaidToAvif: () => configGetters.outputPath.convertMermaidToAvif(configuration),
    convertPngToGif: () => configGetters.outputPath.convertPngToGif(configuration),
    convertJpegToGif: () => configGetters.outputPath.convertJpegToGif(configuration),
    convertWebpToGif: () => configGetters.outputPath.convertWebpToGif(configuration),
    convertAvifToGif: () => configGetters.outputPath.convertAvifToGif(configuration),
    convertGifToPng: () => configGetters.outputPath.convertGifToPng(configuration),
    convertTiffToPng: () => configGetters.outputPath.convertTiffToPng(configuration),
    convertTiffToGif: () => configGetters.outputPath.convertTiffToGif(configuration),
    convertSvgToGif: () => configGetters.outputPath.convertSvgToGif(configuration),
    convertMermaidToGif: () => configGetters.outputPath.convertMermaidToGif(configuration),
    convertPngToTiff: () => configGetters.outputPath.convertPngToTiff(configuration),
    convertJpegToTiff: () => configGetters.outputPath.convertJpegToTiff(configuration),
    convertWebpToTiff: () => configGetters.outputPath.convertWebpToTiff(configuration),
    convertAvifToTiff: () => configGetters.outputPath.convertAvifToTiff(configuration),
    convertGifToTiff: () => configGetters.outputPath.convertGifToTiff(configuration),
    convertSvgToTiff: () => configGetters.outputPath.convertSvgToTiff(configuration),
    convertMermaidToTiff: () => configGetters.outputPath.convertMermaidToTiff(configuration),
    convertPngToEps: () => configGetters.outputPath.convertPngToEps(configuration),
    convertJpegToEps: () => configGetters.outputPath.convertJpegToEps(configuration),
    convertWebpToEps: () => configGetters.outputPath.convertWebpToEps(configuration),
    convertAvifToEps: () => configGetters.outputPath.convertAvifToEps(configuration),
    convertSvgToEps: () => configGetters.outputPath.convertSvgToEps(configuration),
    convertMermaidToEps: () => configGetters.outputPath.convertMermaidToEps(configuration),
    convertToDrawio: () => configGetters.outputPath.convertToDrawio(configuration),
    convertToDrawioPng: () => configGetters.outputPath.convertToDrawioPng(configuration),
    convertToDrawioSvg: () => configGetters.outputPath.convertToDrawioSvg(configuration),
    clipboardImage: () => configGetters.outputPath.clipboardImage(configuration),
    convertDrawioToPdfDirectly: () => configGetters.outputPath.convertDrawioToPdfDirectly(configuration),
    convertImagesToSinglePdf: () => configGetters.outputPath.convertImagesToSinglePdf(configuration),
    compressPdf: () => configGetters.outputPath.compressPdf(configuration),
  },
  outputPaths: () => configGetters.outputPaths(configuration),
  cropPdf: {
    marginOptions: () => configGetters.cropPdf.marginOptions(configuration),
  },
  contextMenu: {
    enabled: () => configGetters.contextMenu.enabled(configuration),
    cropPdf: {
      enabled: () => configGetters.contextMenu.cropPdf.enabled(configuration),
    },
    splitPdf: {
      enabled: () => configGetters.contextMenu.splitPdf.enabled(configuration),
    },
    mergePdf: {
      enabled: () => configGetters.contextMenu.mergePdf.enabled(configuration),
    },
    convertDrawio: {
      enabled: () => configGetters.contextMenu.convertDrawio.enabled(configuration),
    },
    convertPdf: {
      enabled: () => configGetters.contextMenu.convertPdf.enabled(configuration),
    },
    convertPng: {
      enabled: () => configGetters.contextMenu.convertPng.enabled(configuration),
    },
    convertJpeg: {
      enabled: () => configGetters.contextMenu.convertJpeg.enabled(configuration),
    },
    convertWebp: {
      enabled: () => configGetters.contextMenu.convertWebp.enabled(configuration),
    },
    convertAvif: {
      enabled: () => configGetters.contextMenu.convertAvif.enabled(configuration),
    },
    convertSvg: {
      enabled: () => configGetters.contextMenu.convertSvg.enabled(configuration),
    },
    convertMermaid: {
      enabled: () => configGetters.contextMenu.convertMermaid.enabled(configuration),
    },
    convertRaw: {
      enabled: () => configGetters.contextMenu.convertRaw.enabled(configuration),
    },
    convertDrawioCreate: {
      enabled: () => configGetters.contextMenu.convertDrawioCreate.enabled(configuration),
    },
    compressPdf: {
      enabled: () => configGetters.contextMenu.compressPdf.enabled(configuration),
    },
  },
} as const;
