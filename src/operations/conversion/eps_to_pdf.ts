import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';

import {
  createAsciiInputOutputScratch,
  defaultWindowsScratchBaseCandidates,
  removeSuccessfulScratch,
  type LineOutputChannel,
  validateAsciiScratchInput,
  validateAsciiScratchOutput,
} from '../external_tools/external_tool_ascii_scratch.js';
import { runExternalTool } from '../external_tools/run_external_tool.js';

export interface EpsToPdfResult {
  pdfPath: string;
  stagingDirectory: string;
}

export interface EpsToPdfOptions {
  epsPath: string;
  workspacePath: string;
  stagingDirectory: string;
  tools: {
    ghostscriptPath: string;
    runGhostscript?: RunGhostscript;
  };
  signal?: AbortSignal;
  outputChannel?: LineOutputChannel;
  platform?: NodeJS.Platform;
  scratchBaseCandidates?: readonly string[];
  timeout?: number;
}

type RunGhostscript = (executable: string, args: string[], timeout: number, signal?: AbortSignal) => Promise<void>;

/**
 * Converts an EPS file to a single-page PDF via Ghostscript.
 * Returns the path to the generated PDF and the staging directory for cleanup.
 */
export async function convertEpsToPdf(options: EpsToPdfOptions): Promise<EpsToPdfResult> {
  options.signal?.throwIfAborted();

  const platform = options.platform ?? process.platform;
  const timeout = options.timeout ?? 30_000;

  await mkdir(options.stagingDirectory, { recursive: true });

  const stagingEpsPath = path.join(options.stagingDirectory, 'source.eps');
  await copyFile(options.epsPath, stagingEpsPath);
  options.signal?.throwIfAborted();

  const pdfPath = path.join(options.stagingDirectory, 'eps-result.pdf');
  if (platform === 'win32') {
    return convertEpsToPdfOnWindows(options, stagingEpsPath, pdfPath, timeout);
  }

  await runGhostscriptCommand(options, stagingEpsPath, pdfPath, timeout);
  await validateGeneratedPdf(pdfPath);

  return { pdfPath, stagingDirectory: options.stagingDirectory };
}

async function convertEpsToPdfOnWindows(
  options: EpsToPdfOptions,
  stagingEpsPath: string,
  pdfPath: string,
  timeout: number,
): Promise<EpsToPdfResult> {
  const scratchOptions: Parameters<typeof createAsciiInputOutputScratch>[0] = {
    baseCandidates: options.scratchBaseCandidates ?? defaultWindowsScratchBaseCandidates(),
    inputFileName: 'source.eps',
    outputFileName: 'output.pdf',
    toolName: 'Ghostscript',
  };
  if (options.signal !== undefined) {
    scratchOptions.signal = options.signal;
  }
  if (options.outputChannel !== undefined) {
    scratchOptions.outputChannel = options.outputChannel;
  }
  const scratch = await createAsciiInputOutputScratch(scratchOptions);
  let scratchSucceeded = false;

  try {
    await copyFile(stagingEpsPath, scratch.inputPath);
    await validateAsciiScratchInput(scratch);
    options.outputChannel?.appendLine(`[scratch] logical input: ${options.epsPath}`);
    options.outputChannel?.appendLine(`[scratch] tool input: ${scratch.inputPath}`);
    options.outputChannel?.appendLine(`[scratch] tool output: ${scratch.outputPath}`);
    options.signal?.throwIfAborted();

    await runGhostscriptCommand(options, scratch.inputPath, scratch.outputPath, timeout);
    await validateAsciiScratchOutput(scratch);
    await validateGeneratedPdf(scratch.outputPath);
    await copyFile(scratch.outputPath, pdfPath);
    options.signal?.throwIfAborted();
    await validateGeneratedPdf(pdfPath);
    options.signal?.throwIfAborted();
    options.outputChannel?.appendLine(`[scratch] staged output: ${pdfPath}`);
    scratchSucceeded = true;

    return { pdfPath, stagingDirectory: options.stagingDirectory };
  } finally {
    if (scratchSucceeded) {
      await removeSuccessfulScratch(scratch, options.outputChannel);
    } else {
      options.outputChannel?.appendLine(`[scratch] retained after failure or cancellation: ${scratch.rootPath}`);
    }
  }
}

async function runGhostscriptCommand(
  options: EpsToPdfOptions,
  inputPath: string,
  outputPath: string,
  timeout: number,
): Promise<void> {
  const runGhostscript = options.tools.runGhostscript ?? executeGhostscript;
  await runGhostscript(
    options.tools.ghostscriptPath,
    ['-dSAFER', '-dNOPAUSE', '-dBATCH', '-dEPSCrop', '-sDEVICE=pdfwrite', `-sOutputFile=${outputPath}`, inputPath],
    timeout,
    options.signal,
  );
  options.signal?.throwIfAborted();
}

async function validateGeneratedPdf(pdfPath: string): Promise<void> {
  const fileStat = await stat(pdfPath);

  if (!fileStat.isFile()) {
    throw new Error(`EPS conversion produced no output: ${pdfPath}`);
  }

  if (fileStat.size === 0) {
    throw new Error(`EPS conversion produced empty PDF: ${pdfPath}`);
  }

  const pdfBytes = await readFile(pdfPath);
  const header = pdfBytes.subarray(0, 5).toString('ascii');

  if (header !== '%PDF-') {
    throw new Error(`EPS conversion produced non-PDF output: ${pdfPath}`);
  }

  let document: PDFDocument;

  try {
    document = await PDFDocument.load(pdfBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`EPS conversion produced an unparsable PDF: ${message}`, { cause: error });
  }

  let pageCount: number;

  try {
    pageCount = document.getPageCount();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`EPS conversion produced an unparsable PDF: ${message}`, { cause: error });
  }

  if (pageCount !== 1) {
    throw new Error(`EPS conversion must produce exactly one PDF page (found ${pageCount}): ${pdfPath}`);
  }

  let page;

  try {
    page = document.getPage(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`EPS conversion produced an unparsable PDF: ${message}`, { cause: error });
  }
  const pageBoxes = [
    ['MediaBox', page.getMediaBox()],
    ['CropBox', page.getCropBox()],
    ['TrimBox', page.getTrimBox()],
  ] as const;

  for (const [boxName, box] of pageBoxes) {
    const values = [box.x, box.y, box.width, box.height];

    if (!values.every((value) => Number.isFinite(value)) || box.width <= 0 || box.height <= 0) {
      throw new Error(`EPS conversion produced invalid ${boxName} dimensions: ${pdfPath}`);
    }
  }
}

async function executeGhostscript(
  executable: string,
  args: string[],
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  await runExternalTool({
    toolName: 'Ghostscript',
    executable,
    args,
    timeoutMs: timeout,
    ...(signal === undefined ? {} : { signal }),
  });
}
