import type { Configuration } from '../../generated/extension_manifest.js';
import {
  executeDrawio,
  type DrawioBackend,
} from '@graphics-workbench/core/operations/conversion/tools/drawio_tools.js';

/** Creates the Draw.io backend from the configured executable path and the real process runner. */
export function createDrawioBackend(configuration: Configuration): DrawioBackend {
  return { drawioPath: configuration.execPath.drawio(), runDrawio: executeDrawio };
}
