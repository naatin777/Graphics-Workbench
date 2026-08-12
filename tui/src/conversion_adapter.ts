import {
  planPdfRasterConversion as planCorePdfRasterConversion,
  runPdfRasterConversion,
  type PdfRasterConversionPlan,
  type PdfRasterConversionResult,
  type PdfRasterPageSelection,
  type PdfRasterSource,
  type PdfRasterTarget,
} from '@graphics-workbench/core/conversion';
import {
  cleanupConversionArtifacts,
  type CleanupResult,
  type ConversionExecutionContext,
} from '@graphics-workbench/core/runtime';
import { sourceFormatForPath } from '@graphics-workbench/core/formats';

export const terminalUiRasterTargets = ['png', 'jpeg', 'webp'] as const satisfies readonly PdfRasterTarget[];
export type TerminalUiRasterTarget = (typeof terminalUiRasterTargets)[number];
export type TerminalUiPdfRasterPlan = PdfRasterConversionPlan & { target: TerminalUiRasterTarget };

export interface TerminalUiConversionResult extends PdfRasterConversionResult {
  cleanup: CleanupResult;
}

export function availableTerminalUiRasterTargets(sourcePath: string): readonly TerminalUiRasterTarget[] {
  return sourceFormatForPath(sourcePath) === 'pdf' ? terminalUiRasterTargets : [];
}

export async function runTerminalPdfRasterConversion(options: {
  plan: TerminalUiPdfRasterPlan;
  runtime: ConversionExecutionContext;
  maxInputPixels: number;
  webpEffort?: number;
}): Promise<TerminalUiConversionResult> {
  const result = await runPdfRasterConversion(options);
  const cleanup = await cleanupConversionArtifacts(result.artifacts, options.runtime.outputChannel);
  return { ...result, cleanup };
}

export function planPdfRasterConversion(options: {
  source: PdfRasterSource;
  target: TerminalUiRasterTarget;
  selection: PdfRasterPageSelection;
  outputTemplate: string;
}): TerminalUiPdfRasterPlan {
  const plan = planCorePdfRasterConversion(options);
  return { ...plan, target: options.target };
}

export { inspectPdfRasterSource, resolvePdfRasterPages } from '@graphics-workbench/core/conversion';
export type { PdfRasterSource, PdfRasterTarget } from '@graphics-workbench/core/conversion';
