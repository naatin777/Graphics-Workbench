import type { Configuration } from '../generated/extension_manifest.js';

export function getMaxUndoRecords(configuration: Configuration): number {
  return configuration.undoHistory.maxRecords();
}
