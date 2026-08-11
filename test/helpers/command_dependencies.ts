import type { CommandDependencies } from '../../vscode/src/commands/shared/command_dependencies.js';

import { getExtensionConfiguration } from '../../vscode/src/config/extension_configuration.js';
import { fakeConfiguration } from './configuration.js';
import { RecordingOutputChannel } from './recording_output_channel.js';

export function testCommandDependencies(values: Record<string, unknown> = {}): CommandDependencies {
  return {
    getConfiguration: () => fakeConfiguration(values),
    outputChannel: new RecordingOutputChannel(),
  };
}

/** CommandDependencies whose configuration reads real workspace settings (for command integration tests). */
export function liveCommandDependencies(): CommandDependencies {
  return {
    getConfiguration: getExtensionConfiguration,
    outputChannel: new RecordingOutputChannel(),
  };
}
