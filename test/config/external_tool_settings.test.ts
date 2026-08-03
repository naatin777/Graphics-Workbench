import assert from 'node:assert/strict';

import {
  defaultExternalToolTimeouts,
  readExternalToolTimeouts,
  timeoutMilliseconds,
} from '../../src/config/external_tools/external_tool_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部ツールタイムアウト設定', () => {
  test('既存の既定値を秒からミリ秒へ変換する', () => {
    assert.strictEqual(defaultExternalToolTimeouts().qpdf, 120_000);
    assert.strictEqual(defaultExternalToolTimeouts().drawio, 300_000);
    assert.strictEqual(timeoutMilliseconds(0), undefined);
    assert.strictEqual(timeoutMilliseconds(86_400), 86_400_000);
  });

  test('0を無期限として読み取る', () => {
    const timeouts = readExternalToolTimeouts(
      fakeConfiguration({
        'externalTools.qpdf.timeoutSeconds': 0,
        'externalTools.mermaid.timeoutSeconds': 5,
      }),
    );

    assert.strictEqual(timeouts.qpdf, undefined);
    assert.strictEqual(timeouts.mermaid, 5_000);
  });
});
