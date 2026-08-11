import * as vscode from 'vscode';

import { createConfiguration, extensionIdentity, type Configuration } from '../generated/extension_manifest.js';

export function getExtensionConfiguration(): Configuration {
  return createConfiguration({
    // oxlint-disable-next-line typescript/no-restricted-types -- ConfigurationReaderインターフェースがunknownを要求する。
    get(key: string): unknown {
      return vscode.workspace.getConfiguration(extensionIdentity.configurationNamespace).get(key);
    },
  });
}
