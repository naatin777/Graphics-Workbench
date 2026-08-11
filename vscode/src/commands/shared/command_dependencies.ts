import type { GetConfiguration } from '../../generated/extension_manifest.js';
import type { LineOutputChannel } from '@graphics-workbench/core/operations/external_tools/external_tool_ascii_scratch.js';

export interface CommandDependencies {
  getConfiguration: GetConfiguration;
  outputChannel: LineOutputChannel;
}
