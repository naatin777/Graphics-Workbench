import assert from 'node:assert/strict';

import {
  defaultExternalToolTimeouts,
  readExternalToolTimeouts,
  timeoutMilliseconds,
} from '../../src/config/external_tools/external_tool_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部ツールタイムアウト設定', () => {
  test('既定値はタイムアウトなし（0を秒からミリ秒へ変換しない）', () => {
    assert.strictEqual(defaultExternalToolTimeouts().drawio, undefined);
    assert.strictEqual(defaultExternalToolTimeouts().mermaid, undefined);
    assert.strictEqual(timeoutMilliseconds(0), undefined);
    assert.strictEqual(timeoutMilliseconds(86_400), 86_400_000);
  });

  test('0を無期限として読み取る', () => {
    const timeouts = readExternalToolTimeouts(
      fakeConfiguration({
        'externalTools.pdftocairo.timeoutSeconds': 0,
        'externalTools.mermaid.timeoutSeconds': 5,
      }),
    );

    assert.strictEqual(timeouts.pdftocairo, undefined);
    assert.strictEqual(timeouts.mermaid, 5_000);
  });
});
