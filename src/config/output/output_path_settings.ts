import type { Configuration, OutputPaths } from '../../generated-extension-meta.js';

export type OutputPathKey = keyof OutputPaths;

function isOutputPaths(value: unknown): value is OutputPaths {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveOutputPathsTemplate(
  configuration: Configuration,
  key: OutputPathKey,
  defaultValue: string,
): string {
  const outputPaths = configuration.outputPaths();
  if (!isOutputPaths(outputPaths)) {
    return defaultValue;
  }
  const template = outputPaths[key];
  return typeof template === 'string' && template.trim() !== '' ? template : defaultValue;
}

export function resolveOutputPathTemplate(template: string, defaultValue: string): string {
  return template.trim() === '' ? defaultValue : template;
}
