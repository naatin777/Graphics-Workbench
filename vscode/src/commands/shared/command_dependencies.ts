import type { GetConfiguration } from '../../generated/extension_manifest.js';
import type { LineOutputChannel } from '@graphics-workbench/core/external-tools';

export interface CommandDependencies {
  getConfiguration: GetConfiguration;
  outputChannel: LineOutputChannel;
}
