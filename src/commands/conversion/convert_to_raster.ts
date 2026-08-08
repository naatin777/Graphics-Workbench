import type * as vscode from 'vscode';

import type { Configuration } from '../../generated/extension_manifest.js';
import { readMermaidCliOptions } from '../../config/rendering/mermaid_cli_options.js';
import {
  executeAvifConversion,
  executeGifConversion,
  executeJpegConversion,
  executePngConversion,
  executeTiffConversion,
  executeWebpConversion,
  type AvifOutputOptions,
  type CommittedConversionOutput,
  type RasterJob,
  type WebpOutputOptions,
} from '../../operations/conversion/raster_conversion.js';
import type { DrawioBackend } from '../../operations/conversion/tools/drawio_tools.js';
import type { MermaidBackend } from '../../operations/conversion/tools/mermaid_tools.js';
import type { PdfRenderBackend } from '../../operations/conversion/tools/pdf_render_tools.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import { buildDrawioCommandOptions } from '../shared/command_runtime.js';

import { planRasterConversionJobs, type RasterFormatSpec } from './plan_conversion_jobs.js';
import {
  runAnimatedRasterConversionCommand,
  runSimpleRasterConversionCommand,
  type RasterConversionContext,
} from './run_raster_conversion_command.js';

export interface ConvertToWebpCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

export interface ConvertToGifCommandOptions {
  outputMode?: 'auto' | 'preserve' | 'split';
}

interface RasterBackendTools {
  mermaidTools: MermaidBackend;
  drawioTools: DrawioBackend;
  pdfRenderTools: PdfRenderBackend;
}

type RasterPlanContext<Prepared> = RasterConversionContext<Prepared> & { maxAnimationPixels?: number };

export const pngSpec: RasterFormatSpec = {
  target: 'png',
  operationName: 'convert-to-png',
  outputLabel: 'PNG',
  extensions: ['.png'],
  label: 'PNG',
  settings: {
    drawio: 'convertDrawioToPng',
    pdf: 'convertPdfToPng',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.png',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
  },
};

export const jpegSpec: RasterFormatSpec = {
  target: 'jpeg',
  operationName: 'convert-to-jpeg',
  outputLabel: 'JPEG',
  extensions: ['.jpg', '.jpeg'],
  label: 'JPEG',
  settings: {
    drawio: 'convertDrawioToJpeg',
    pdf: 'convertPdfToJpeg',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.jpeg',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.jpeg',
  },
};

export const avifSpec: RasterFormatSpec = {
  target: 'avif',
  operationName: 'convert-to-avif',
  outputLabel: 'AVIF',
  extensions: ['.avif'],
  label: 'AVIF',
  settings: {
    drawio: 'convertDrawioToAvif',
    pdf: 'convertPdfToAvif',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.avif',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.avif',
  },
};

export const tiffSpec: RasterFormatSpec = {
  target: 'tiff',
  operationName: 'convert-to-tiff',
  outputLabel: 'TIFF',
  extensions: ['.tif', '.tiff'],
  label: 'TIFF',
  settings: {
    drawio: 'convertDrawioToTiff',
    pdf: 'convertPdfToTiff',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.tiff',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.tiff',
  },
};

export const webpSpec: RasterFormatSpec = {
  target: 'webp',
  operationName: 'convert-to-webp',
  outputLabel: 'WebP',
  extensions: ['.webp'],
  label: 'WebP',
  settings: {
    drawio: 'convertDrawioToWebp',
    pdf: 'convertPdfToWebp',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.webp',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.webp',
    split: '${fileDirname}/${fileBasenameNoExtension}-${page}.webp',
  },
  animatedInputExtension: '.gif',
};

export const gifSpec: RasterFormatSpec = {
  target: 'gif',
  operationName: 'convert-to-gif',
  outputLabel: 'GIF',
  extensions: ['.gif'],
  label: 'GIF',
  settings: {
    drawio: 'convertDrawioToGif',
    pdf: 'convertPdfToGif',
  },
  defaults: {
    pdf: '${fileDirname}/${fileBasenameNoExtension}-${page}.gif',
    drawio: '${fileDirname}/${fileBasenameNoExtension}/${page}.gif',
    split: '${fileDirname}/${fileBasenameNoExtension}-${page}.gif',
  },
  animatedInputExtension: '.webp',
};

function readBackendTools(configuration: Configuration): RasterBackendTools {
  return {
    mermaidTools: readMermaidCliOptions(configuration),
    drawioTools: buildDrawioCommandOptions(configuration),
    pdfRenderTools: {},
  };
}

function readAvifOutputOptions(configuration: Configuration): AvifOutputOptions {
  const effort = configuration.convertToAvif.effort();

  if (!Number.isInteger(effort) || effort < 0 || effort > 9) {
    throw new Error(`convertToAvif.effort must be an integer between 0 and 9: ${effort}`);
  }

  return { effort };
}

function readWebpOutputOptions(configuration: Configuration): WebpOutputOptions {
  const effort = configuration.convertToWebp.effort();

  if (!Number.isInteger(effort) || effort < 0 || effort > 6) {
    throw new Error(`convertToWebp.effort must be an integer between 0 and 6: ${effort}`);
  }

  return { effort };
}

async function runRasterCommand<Prepared>(options: {
  uri?: vscode.Uri | undefined;
  uris?: vscode.Uri[] | undefined;
  dependencies?: CommandDependencies | undefined;
  spec: RasterFormatSpec;
  animated: boolean;
  outputMode?: 'auto' | 'preserve' | 'split' | undefined;
  prepare: (configuration: Configuration) => Prepared;
  execute: (jobs: RasterJob[], context: RasterPlanContext<Prepared>) => Promise<CommittedConversionOutput[]>;
}): Promise<void> {
  const { spec, animated } = options;
  const plan = async (sourceUri: vscode.Uri, context: RasterPlanContext<Prepared>): Promise<RasterJob[]> =>
    planRasterConversionJobs(sourceUri, spec, {
      configuration: context.configuration,
      maxInputPixels: context.maxInputPixels,
      ...(animated && context.maxAnimationPixels !== undefined
        ? { maxAnimationPixels: context.maxAnimationPixels }
        : {}),
      ...(options.outputMode !== undefined && { outputMode: options.outputMode }),
      runtime: context.runtime,
    });

  if (animated) {
    return runAnimatedRasterConversionCommand<RasterJob, Prepared>({
      uri: options.uri,
      uris: options.uris,
      dependencies: options.dependencies,
      operationName: spec.operationName,
      outputLabel: spec.outputLabel,
      prepare: options.prepare,
      plan,
      execute: options.execute,
    });
  }

  return runSimpleRasterConversionCommand<RasterJob, Prepared>({
    uri: options.uri,
    uris: options.uris,
    dependencies: options.dependencies,
    operationName: spec.operationName,
    outputLabel: spec.outputLabel,
    prepare: options.prepare,
    plan,
    execute: options.execute,
  });
}

export async function convertToPngCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runRasterCommand<RasterBackendTools>({
    uri,
    uris,
    dependencies,
    spec: pngSpec,
    animated: false,
    prepare: readBackendTools,
    execute: async (jobs, context) =>
      executePngConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}

export async function convertToJpegCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runRasterCommand<RasterBackendTools>({
    uri,
    uris,
    dependencies,
    spec: jpegSpec,
    animated: false,
    prepare: readBackendTools,
    execute: async (jobs, context) =>
      executeJpegConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}

export async function convertToTiffCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runRasterCommand<RasterBackendTools>({
    uri,
    uris,
    dependencies,
    spec: tiffSpec,
    animated: false,
    prepare: readBackendTools,
    execute: async (jobs, context) =>
      executeTiffConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}

export async function convertToAvifCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
): Promise<void> {
  await runRasterCommand<RasterBackendTools & { avif: AvifOutputOptions }>({
    uri,
    uris,
    dependencies,
    spec: avifSpec,
    animated: false,
    prepare: (configuration) => ({ ...readBackendTools(configuration), avif: readAvifOutputOptions(configuration) }),
    execute: async (jobs, context) =>
      executeAvifConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}

export async function convertToWebpCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToWebpCommandOptions,
): Promise<void> {
  await runRasterCommand<RasterBackendTools & { webp: WebpOutputOptions }>({
    uri,
    uris,
    dependencies,
    spec: webpSpec,
    animated: true,
    outputMode: options?.outputMode,
    prepare: (configuration) => ({ ...readBackendTools(configuration), webp: readWebpOutputOptions(configuration) }),
    execute: async (jobs, context) =>
      executeWebpConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}

export async function convertToGifCommand(
  uri?: vscode.Uri,
  uris?: vscode.Uri[],
  dependencies?: CommandDependencies,
  options?: ConvertToGifCommandOptions,
): Promise<void> {
  await runRasterCommand<RasterBackendTools>({
    uri,
    uris,
    dependencies,
    spec: gifSpec,
    animated: true,
    outputMode: options?.outputMode,
    prepare: readBackendTools,
    execute: async (jobs, context) =>
      executeGifConversion({
        jobs,
        runtime: context.runtime,
        maxInputPixels: context.maxInputPixels,
        ...context.prepared,
      }),
  });
}
