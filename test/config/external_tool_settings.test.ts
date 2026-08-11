import assert from 'node:assert/strict';

import {
  readExternalToolTimeouts,
  timeoutMilliseconds,
} from '@graphics-workbench/core/config/external_tools/external_tool_settings.js';
import { fakeConfiguration } from '../helpers/configuration.js';

suite('外部ツールタイムアウト設定', () => {
  test('設定未指定の既定タイムアウトはdrawio/mermaidともundefinedで、timeoutMillisecondsは0をundefinedのままにし86400秒を86,400,000ミリ秒へ変換する', () => {
    const timeouts = readExternalToolTimeouts(fakeConfiguration({}));

    assert.strictEqual(timeouts.drawio, undefined);
    assert.strictEqual(timeouts.mermaid, undefined);
    assert.strictEqual(timeoutMilliseconds(0), undefined);
    assert.strictEqual(timeoutMilliseconds(86_400), 86_400_000);
  });

  test('rsvgConvertのtimeoutSecondsが0なら無期限(undefined)として読み取り、mermaidのtimeoutSeconds=5は5,000ミリ秒に変換する', () => {
    const timeouts = readExternalToolTimeouts(
      fakeConfiguration({
        'externalTools.rsvgConvert.timeoutSeconds': 0,
        'externalTools.mermaid.timeoutSeconds': 5,
      }),
    );

    assert.strictEqual(timeouts.rsvgConvert, undefined);
    assert.strictEqual(timeouts.mermaid, 5_000);
  });
});
