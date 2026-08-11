// Test target:
// - Controlsボタン（status bar item）がアイコンのみ・tooltip・commandで作成されること
// - Controlsパネル（QuickPick）が開き、Tools / Conversions / SVG→PDF / Safe Mode / Feature availability の各ブロックを持つこと
// - SVG→PDF変換エンジンをラジオ的に選択でき、選択がconfigへ保存され反映されること
// - 選択したエンジンが利用できない場合、自動で別エンジンへフォールバックしないこと
// - Single / Split / Combine のON/OFFが対応設定（conversion.single/split/combine.enabled）と同期すること
// - Safe ModeのON/OFFが既存設定（globalState）と同期すること
// - Feature availabilityが機能単位で✓/✕表示されること
// - 外部toolのavailability行から関連するVS Code Settingsを開けること
// - Check againでavailabilityを再チェックして表示を更新すること
//
// Mocked:
// - vscode.window.createStatusBarItem
// - vscode.window.createQuickPick
// - ExtensionContext.globalState相当のkey-value storage
//
// Not tested:
// - 実際のVS Code画面上のstatus bar・QuickPick描画
// - 実際の外部ツール実行

import assert from 'node:assert/strict';

import { createSandbox } from 'sinon';
import * as vscode from 'vscode';

import {
  initializeControlsPanel,
  showControlsPanel,
  type ControlsPanelDependencies,
  type ControlsQuickPickItem,
  type SvgToPdfEngine,
} from '../../src/commands/lifecycle/controls_panel.js';
import { SafeModeState } from '../../src/commands/lifecycle/safe_mode.js';
import type { FeatureAvailabilityEntry } from '../../src/commands/shared/environment_check.js';
import { userMessage } from '../../src/commands/shared/user_messages.js';
import { fakeConfiguration } from '../helpers/configuration.js';

const FEATURE_PDF = userMessage('message.controls.feature.pdfOperations');
const FEATURE_IMAGES = userMessage('message.controls.feature.images');
const FEATURE_SVG_TO_PDF = userMessage('message.controls.feature.svgToPdf');
const FEATURE_DRAWIO = userMessage('message.controls.feature.drawio');
const FEATURE_MERMAID = userMessage('message.controls.feature.mermaid');

suite('Controlsパネル', () => {
  let sandbox: sinon.SinonSandbox;
  let subscriptions: vscode.Disposable[];

  setup(() => {
    sandbox = createSandbox();
    subscriptions = [];
  });

  teardown(() => {
    sandbox.restore();
  });

  test('status barにアイコンのみのControlsボタンを配置し、tooltipとopenControlsコマンドを設定して表示する', () => {
    const statusBarItem = new FakeStatusBarItem();
    sandbox.stub(vscode.window, 'createStatusBarItem').returns(statusBarItem);

    initializeControlsPanel({ subscriptions });

    assert.strictEqual(statusBarItem.text, '$(sliders)');
    assert.strictEqual(statusBarItem.tooltip, 'Graphics Workbench Controls');
    assert.strictEqual(statusBarItem.command, 'graphics-workbench.openControls');
    assert.strictEqual(statusBarItem.showCallCount, 1);
    assert.deepStrictEqual(subscriptions, [statusBarItem]);
  });

  test('Controlsパネルを開くとQuickPickにtitle Graphics Workbenchと各ブロック（Tools / Conversions / SVG→PDF / Safe Mode / Feature availability）を表示する', async () => {
    const quickPick = createFakeQuickPick();
    const storage = new MemoryState();
    const state = new SafeModeState(storage);
    const entries: FeatureAvailabilityEntry[] = [
      { id: 'pdf-operations', available: true, detail: 'ok' },
      { id: 'images', available: true, detail: 'ok' },
      { id: 'svg-to-pdf', available: true, detail: 'ok' },
      { id: 'drawio', available: false, detail: 'missing' },
      { id: 'mermaid', available: true, detail: 'ok' },
    ];

    await showControlsPanel(
      createDependencies({
        quickPick,
        safeMode: state,
        availability: entries,
        engine: 'chrome',
      }),
    );

    assert.strictEqual(quickPick.title, 'Graphics Workbench');
    assert.strictEqual(quickPick.canSelectMany, false);
    const labels = quickPick.items.map((item) => item.label);
    assert.deepStrictEqual(labels.slice(0, 5), [
      userMessage('message.controls.section.tools'),
      userMessage('message.controls.section.conversions'),
      userMessage('message.controls.conversionSingle'),
      userMessage('message.controls.conversionSplit'),
      userMessage('message.controls.conversionCombine'),
    ]);
    assert.ok(labels.includes(userMessage('message.controls.section.svgToPdf')));
    assert.ok(labels.includes(userMessage('message.controls.section.safeMode')));
    assert.ok(labels.includes(userMessage('message.controls.section.availability')));
    assert.ok(labels.includes(`$(refresh) ${userMessage('message.controls.checkAgain')}`));
  });

  test('ConversionsのSingle/Split/Combineが対応設定と同期し、パネル上で切り替えると設定へ保存して表示を更新する', async () => {
    const quickPick = createFakeQuickPick();
    const written: { category: 'single' | 'split' | 'combine'; enabled: boolean }[] = [];

    await showControlsPanel(
      createDependencies({
        quickPick,
        engine: 'chrome',
        conversions: { single: true, split: true, combine: true },
        writeConversionEnabled: async (category, enabled) => {
          written.push({ category, enabled });
        },
      }),
    );

    const conversionItems = (): Map<'single' | 'split' | 'combine', ControlsQuickPickItem> => {
      const items = new Map<'single' | 'split' | 'combine', ControlsQuickPickItem>();
      for (const item of quickPick.items) {
        if (item.action?.kind === 'toggle-conversion') {
          items.set(item.action.category, item);
        }
      }
      return items;
    };

    assert.strictEqual(conversionItems().get('single')?.description, '[ON]');
    assert.strictEqual(conversionItems().get('split')?.description, '[ON]');
    assert.strictEqual(conversionItems().get('combine')?.description, '[ON]');

    quickPick.triggerSelection(conversionItems().get('single')!);
    await flushPromises();

    assert.deepStrictEqual(written, [{ category: 'single', enabled: false }]);
    assert.strictEqual(conversionItems().get('single')?.description, '[OFF]');

    quickPick.triggerSelection(conversionItems().get('combine')!);
    await flushPromises();

    assert.deepStrictEqual(written, [
      { category: 'single', enabled: false },
      { category: 'combine', enabled: false },
    ]);
    assert.strictEqual(conversionItems().get('combine')?.description, '[OFF]');
    assert.strictEqual(conversionItems().get('split')?.description, '[ON]');
  });

  test('SVG→PDFエンジンのラジオ表示が現在のconfig設定と一致し、選択するとconfigへ保存してラジオ表示を更新する', async () => {
    const quickPick = createFakeQuickPick();
    const storage = new MemoryState();
    const state = new SafeModeState(storage);
    const written: SvgToPdfEngine[] = [];

    await showControlsPanel(
      createDependencies({
        quickPick,
        safeMode: state,
        engine: 'chrome',
        writeEngine: async (engine) => {
          written.push(engine);
        },
      }),
    );

    const engineLabels = () =>
      quickPick.items.flatMap((item) => {
        if (item.action?.kind !== 'set-engine') {
          return [];
        }
        return [{ label: item.label, engine: item.action.engine }];
      });

    const chromeRow = engineLabels().find((row) => row.engine === 'chrome');
    const rsvgRow = engineLabels().find((row) => row.engine === 'rsvg-convert');
    assert.ok(chromeRow?.label.startsWith('$(circle-filled)'));
    assert.ok(rsvgRow?.label.startsWith('$(circle-outline)'));

    const rsvgItem = quickPick.items.find(
      (item) => item.action?.kind === 'set-engine' && item.action.engine === 'rsvg-convert',
    );
    assert.ok(rsvgItem);
    quickPick.triggerSelection(rsvgItem);
    await flushPromises();

    assert.deepStrictEqual(written, ['rsvg-convert']);
    const updatedRsvg = quickPick.items.find(
      (item) => item.action?.kind === 'set-engine' && item.action.engine === 'rsvg-convert',
    );
    const updatedChrome = quickPick.items.find(
      (item) => item.action?.kind === 'set-engine' && item.action.engine === 'chrome',
    );
    assert.ok(updatedRsvg?.label.startsWith('$(circle-filled)'));
    assert.ok(updatedChrome?.label.startsWith('$(circle-outline)'));
  });

  test('Safe ModeのON/OFFが既存設定（globalState）と同期し、パネル上で切り替えると設定へ保存して表示を更新する', async () => {
    const quickPick = createFakeQuickPick();
    const storage = new MemoryState();
    const state = new SafeModeState(storage);

    await showControlsPanel(
      createDependencies({
        quickPick,
        safeMode: state,
        engine: 'chrome',
      }),
    );

    const safeModeItem = () => quickPick.items.find((item) => item.action?.kind === 'toggle-safe-mode');
    assert.ok(safeModeItem());
    assert.strictEqual(safeModeItem()?.description, '[ON]');

    quickPick.triggerSelection(safeModeItem()!);
    await flushPromises();

    assert.strictEqual(storage.get('safeMode.enabled'), false);
    assert.strictEqual(safeModeItem()?.description, '[OFF]');
    assert.strictEqual(new SafeModeState(storage).isEnabled(), false);
  });

  test('Feature availabilityが機能単位で✓/✕表示され、unavailableな機能は✕になる', async () => {
    const quickPick = createFakeQuickPick();
    const entries: FeatureAvailabilityEntry[] = [
      { id: 'pdf-operations', available: true, detail: 'ok' },
      { id: 'images', available: true, detail: 'ok' },
      { id: 'svg-to-pdf', available: true, detail: 'ok' },
      { id: 'drawio', available: false, detail: 'missing' },
      { id: 'mermaid', available: true, detail: 'ok' },
    ];

    await showControlsPanel(
      createDependencies({
        quickPick,
        engine: 'chrome',
        availability: entries,
      }),
    );

    const availabilityRows = quickPick.items.filter((item) => item.action?.kind === 'none');
    assert.deepStrictEqual(
      availabilityRows.map((item) => item.label),
      [FEATURE_PDF, FEATURE_IMAGES, FEATURE_SVG_TO_PDF, FEATURE_DRAWIO, FEATURE_MERMAID],
    );
    assert.ok(availabilityRows[0]?.description?.startsWith('$(check)'));
    assert.ok(availabilityRows[3]?.description?.startsWith('$(close)'));
  });

  test('外部toolのavailability行を選択すると、その行に対応するVS Code Settingsを開く', async () => {
    const quickPick = createFakeQuickPick();
    const openedSettings: string[] = [];
    const entries: FeatureAvailabilityEntry[] = [
      { id: 'pdf-operations', available: true, detail: 'ok' },
      { id: 'images', available: true, detail: 'ok' },
      {
        id: 'svg-to-pdf',
        available: false,
        detail: 'missing',
        settingId: 'graphics-workbench.execPath.rsvgConvert',
      },
      { id: 'drawio', available: true, detail: 'ok', settingId: 'graphics-workbench.execPath.drawio' },
      { id: 'mermaid', available: true, detail: 'ok', settingId: 'graphics-workbench.execPath.mermaid' },
    ];

    await showControlsPanel(
      createDependencies({
        quickPick,
        engine: 'rsvg-convert',
        availability: entries,
        openSetting: async (settingId) => {
          openedSettings.push(settingId);
        },
      }),
    );

    const svgRow = quickPick.items.find(
      (item) => item.action?.kind === 'open-setting' && item.label === FEATURE_SVG_TO_PDF,
    );
    assert.ok(svgRow);
    quickPick.triggerSelection(svgRow);
    await flushPromises();

    assert.deepStrictEqual(openedSettings, ['graphics-workbench.execPath.rsvgConvert']);
  });

  test('選択したSVG→PDFエンジンが利用できない場合、自動で別エンジンへフォールバックせず選択状態と✕表示を維持する', async () => {
    const quickPick = createFakeQuickPick();
    const storage = new MemoryState();
    const state = new SafeModeState(storage);
    const written: SvgToPdfEngine[] = [];

    await showControlsPanel(
      createDependencies({
        quickPick,
        safeMode: state,
        engine: 'rsvg-convert',
        availability: (engine) =>
          engine === 'rsvg-convert'
            ? [
                { id: 'pdf-operations', available: true, detail: 'ok' },
                { id: 'images', available: true, detail: 'ok' },
                { id: 'svg-to-pdf', available: false, detail: 'rsvg-convert not found' },
                { id: 'drawio', available: true, detail: 'ok' },
                { id: 'mermaid', available: true, detail: 'ok' },
              ]
            : [],
        writeEngine: async (engine) => {
          written.push(engine);
        },
      }),
    );

    const rsvgRow = quickPick.items.find(
      (item) => item.action?.kind === 'set-engine' && item.action.engine === 'rsvg-convert',
    );
    const chromeRow = quickPick.items.find(
      (item) => item.action?.kind === 'set-engine' && item.action.engine === 'chrome',
    );
    const svgRow = quickPick.items.find((item) => item.action?.kind === 'none' && item.label === FEATURE_SVG_TO_PDF);

    assert.ok(rsvgRow?.label.startsWith('$(circle-filled)'));
    assert.ok(chromeRow?.label.startsWith('$(circle-outline)'));
    assert.ok(svgRow?.description?.startsWith('$(close)'));
    assert.deepStrictEqual(written, []);
  });

  test('Check againでavailabilityを再チェックしてFeature availabilityの表示を更新する', async () => {
    const quickPick = createFakeQuickPick();
    let checkCount = 0;
    const entriesProvider = (): FeatureAvailabilityEntry[] => {
      checkCount += 1;
      return checkCount === 1
        ? [
            { id: 'pdf-operations', available: true, detail: 'ok' },
            { id: 'images', available: true, detail: 'ok' },
            { id: 'svg-to-pdf', available: true, detail: 'ok' },
            { id: 'drawio', available: false, detail: 'missing' },
            { id: 'mermaid', available: true, detail: 'ok' },
          ]
        : [
            { id: 'pdf-operations', available: true, detail: 'ok' },
            { id: 'images', available: true, detail: 'ok' },
            { id: 'svg-to-pdf', available: true, detail: 'ok' },
            { id: 'drawio', available: true, detail: 'ok' },
            { id: 'mermaid', available: true, detail: 'ok' },
          ];
    };

    await showControlsPanel(
      createDependencies({
        quickPick,
        engine: 'chrome',
        availability: entriesProvider,
      }),
    );

    const drawioRowBefore = () =>
      quickPick.items.find((item) => item.action?.kind === 'none' && item.label === FEATURE_DRAWIO);
    assert.ok(drawioRowBefore()?.description?.startsWith('$(close)'));

    const checkAgain = quickPick.items.find((item) => item.action?.kind === 'check-again');
    assert.ok(checkAgain);
    quickPick.triggerSelection(checkAgain);
    await flushPromises();

    assert.strictEqual(checkCount, 2);
    assert.ok(drawioRowBefore()?.description?.startsWith('$(check)'));
  });
});

function createDependencies(overrides: {
  quickPick: FakeQuickPick;
  safeMode?: SafeModeState;
  engine?: SvgToPdfEngine;
  conversions?: Partial<Record<'single' | 'split' | 'combine', boolean>>;
  availability?: FeatureAvailabilityEntry[] | ((engine: SvgToPdfEngine) => FeatureAvailabilityEntry[]);
  writeEngine?: (engine: SvgToPdfEngine) => Promise<void>;
  writeConversionEnabled?: (category: 'single' | 'split' | 'combine', enabled: boolean) => Promise<void>;
  openSetting?: (settingId: string) => Promise<void>;
}): ControlsPanelDependencies {
  const {
    quickPick,
    safeMode,
    engine = 'chrome',
    conversions,
    availability,
    writeEngine,
    writeConversionEnabled,
    openSetting,
  } = overrides;
  const values: Record<string, unknown> = {
    'convertToPdf.svg.engine': engine,
    'conversion.single.enabled': conversions?.single ?? true,
    'conversion.split.enabled': conversions?.split ?? true,
    'conversion.combine.enabled': conversions?.combine ?? true,
  };
  return {
    getConfiguration: () => fakeConfiguration(values),
    getSafeMode: () => safeMode ?? new SafeModeState(new MemoryState()),
    runChecks: async (config) => {
      const entries = availability;
      const engineValue: SvgToPdfEngine = config.convertToPdf.svg.engine();
      if (typeof entries === 'function') {
        return entries(engineValue);
      }
      return entries ?? defaultAvailability();
    },
    writeEngine: async (nextEngine) => {
      if (writeEngine) {
        await writeEngine(nextEngine);
      }
      values['convertToPdf.svg.engine'] = nextEngine;
    },
    writeConversionEnabled: async (category, enabled) => {
      if (writeConversionEnabled) {
        await writeConversionEnabled(category, enabled);
      }
      values[`conversion.${category}.enabled`] = enabled;
    },
    openSetting: openSetting ?? (async () => {}),
    createQuickPick: () => quickPick,
  };
}

function defaultAvailability(): FeatureAvailabilityEntry[] {
  return [
    { id: 'pdf-operations', available: true, detail: 'ok' },
    { id: 'images', available: true, detail: 'ok' },
    { id: 'svg-to-pdf', available: true, detail: 'ok' },
    { id: 'drawio', available: false, detail: 'missing' },
    { id: 'mermaid', available: true, detail: 'ok' },
  ];
}

function createFakeQuickPick(): FakeQuickPick {
  return new FakeQuickPick();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

class FakeQuickPick implements vscode.QuickPick<ControlsQuickPickItem> {
  title: string | undefined;
  step: number | undefined;
  totalSteps: number | undefined;
  enabled = true;
  busy = false;
  ignoreFocusOut = false;
  value = '';
  placeholder: string | undefined;
  prompt: string | undefined;
  buttons: readonly vscode.QuickInputButton[] = [];
  items: readonly ControlsQuickPickItem[] = [];
  canSelectMany = false;
  matchOnDescription = false;
  matchOnDetail = false;
  keepScrollPosition = false;
  activeItems: readonly ControlsQuickPickItem[] = [];
  selectedItems: readonly ControlsQuickPickItem[] = [];

  private selectionListener: ((selection: readonly ControlsQuickPickItem[]) => void) | undefined;
  private hideListener: (() => void) | undefined;
  private acceptListener: (() => void) | undefined;

  readonly onDidHide: vscode.Event<void> = (listener) => {
    this.hideListener = listener;
    return new FakeDisposable();
  };
  readonly onDidChangeValue: vscode.Event<string> = () => new FakeDisposable();
  readonly onDidAccept: vscode.Event<void> = (listener) => {
    this.acceptListener = listener;
    return new FakeDisposable();
  };
  readonly onDidTriggerButton: vscode.Event<vscode.QuickInputButton> = () => new FakeDisposable();
  readonly onDidTriggerItemButton: vscode.Event<vscode.QuickPickItemButtonEvent<ControlsQuickPickItem>> = () =>
    new FakeDisposable();
  readonly onDidChangeActive: vscode.Event<readonly ControlsQuickPickItem[]> = () => new FakeDisposable();
  readonly onDidChangeSelection: vscode.Event<readonly ControlsQuickPickItem[]> = (listener) => {
    this.selectionListener = listener;
    return new FakeDisposable();
  };

  show(): void {}

  hide(): void {
    this.hideListener?.();
  }

  dispose(): void {}

  triggerSelection(item: ControlsQuickPickItem): void {
    this.selectedItems = [item];
    this.selectionListener?.([item]);
  }

  accept(): void {
    this.acceptListener?.();
  }
}

class FakeStatusBarItem implements vscode.StatusBarItem {
  readonly id = 'test.controls';
  readonly alignment = vscode.StatusBarAlignment.Right;
  readonly priority = 100;
  name = 'Test Controls';
  command: string | undefined;
  text = '';
  tooltip: vscode.StatusBarItem['tooltip'] = undefined;
  color: vscode.StatusBarItem['color'] = undefined;
  backgroundColor: vscode.StatusBarItem['backgroundColor'] = undefined;
  accessibilityInformation: vscode.StatusBarItem['accessibilityInformation'] = undefined;
  showCallCount = 0;

  show(): void {
    this.showCallCount += 1;
  }

  hide(): void {}

  dispose(): void {}
}

class MemoryState {
  readonly #values = new Map<string, unknown>();

  get(key: 'safeMode.enabled', defaultValue?: boolean): boolean | undefined {
    const value = this.#values.get(key);
    return typeof value === 'boolean' ? value : defaultValue;
  }

  async update(key: 'safeMode.enabled', value: boolean): Promise<void> {
    this.#values.set(key, value);
  }
}

class FakeDisposable implements vscode.Disposable {
  dispose(): void {}
}
