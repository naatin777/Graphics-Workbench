import { hasExactKeys, isRecord, isString } from '../../../application/protocols/protocol_utils.js';

export type MermaidOutputFormat = 'svg' | 'png' | 'pdf';
type MermaidOutputFilePath = `${string}.svg` | `${string}.png` | `${string}.pdf`;

export interface MermaidRunnerRequest {
  sourcePath: string;
  outputPath: MermaidOutputFilePath;
  outputFormat: MermaidOutputFormat;
  puppeteerConfig: Record<string, unknown>;
  backgroundColor?: string;
  theme?: string;
}

export interface MermaidRunnerSuccess {
  ok: true;
}

export interface MermaidRunnerFailure {
  ok: false;
  error: string;
}

export function parseMermaidRunnerRequest(value: unknown): MermaidRunnerRequest {
  if (!isMermaidRunnerRequest(value)) {
    throw new Error('Invalid Mermaid runner request payload.');
  }

  return value;
}

export function isMermaidRunnerRequest(value: unknown): value is MermaidRunnerRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['sourcePath', 'outputPath', 'outputFormat', 'puppeteerConfig'], ['backgroundColor', 'theme'])
  ) {
    return false;
  }

  return (
    isString(value.sourcePath) &&
    isString(value.outputPath) &&
    isOutputFilePath(value.outputPath) &&
    isMermaidOutputFormat(value.outputFormat) &&
    isPuppeteerConfig(value.puppeteerConfig) &&
    (value.backgroundColor === undefined || isString(value.backgroundColor)) &&
    (value.theme === undefined || isString(value.theme))
  );
}

export function isMermaidRunnerSuccess(value: unknown): value is MermaidRunnerSuccess {
  return isRecord(value) && hasExactKeys(value, ['ok']) && value.ok === true;
}

export function isMermaidRunnerFailure(value: unknown): value is MermaidRunnerFailure {
  return isRecord(value) && hasExactKeys(value, ['ok', 'error']) && value.ok === false && isString(value.error);
}

function isOutputFilePath(value: string): value is MermaidOutputFilePath {
  return value.endsWith('.svg') || value.endsWith('.png') || value.endsWith('.pdf');
}

function isMermaidOutputFormat(value: unknown): value is MermaidOutputFormat {
  return value === 'svg' || value === 'png' || value === 'pdf';
}

function isPuppeteerConfig(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
