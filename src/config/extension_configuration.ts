import * as vscode from 'vscode';

import { createConfiguration, type Configuration } from '../generated/extension_manifest.js';

export function getExtensionConfiguration(): Configuration {
  return createConfiguration({
    get(key: string): unknown {
      return vscode.workspace.getConfiguration('graphics-workbench').get<unknown>(key);
    },
  });
}
