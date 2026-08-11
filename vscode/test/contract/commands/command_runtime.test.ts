// Test target:
// - process-wide runtime設定は明示的なapplyRuntimeConfigurationだけが更新すること

import assert from 'node:assert/strict';

import { applyRuntimeConfiguration } from '../../../src/commands/shared/command_runtime.js';
import { getExternalToolTimeoutMs } from '@graphics-workbench/core/config/external_tools/external_tool_settings.js';
import { fakeConfiguration } from '../../support/helpers/configuration.js';

suite('command runtime設定の所有境界', () => {
  teardown(() => {
    applyRuntimeConfiguration(fakeConfiguration());
  });

  test('activation相当の明示適用で外部tool timeoutをprocess-wide runtimeへ反映する', () => {
    applyRuntimeConfiguration(fakeConfiguration({ 'externalTools.drawio.timeoutSeconds': 5 }));

    assert.strictEqual(getExternalToolTimeoutMs('drawio'), 5_000);
  });
});
