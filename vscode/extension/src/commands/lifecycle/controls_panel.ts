import * as vscode from 'vscode';

import { extensionIdentity, type Configuration } from '../../generated/extension_manifest.js';
import type { CommandDependencies } from '../shared/command_dependencies.js';
import {
  environmentProbe,
  runFeatureAvailabilityChecks,
  type FeatureAvailabilityEntry,
  type FeatureAvailabilityId,
} from '../shared/environment_check.js';
import { userMessage } from '../shared/user_messages.js';
import type { LocaleKeyType } from '../../locale_map.js';

import { getSafeModeState, type SafeModeState } from './safe_mode.js';

const CONTROLS_STATUS_BAR_ID = 'graphics-workbench.controls';

export type SvgToPdfEngine = 'chrome' | 'rsvg-convert';

export type ConversionCategory = 'single' | 'split' | 'combine';

export const CONVERSION_CATEGORIES: readonly ConversionCategory[] = ['single', 'split', 'combine'];

export type ControlsItemAction =
  | { kind: 'set-engine'; engine: SvgToPdfEngine }
  | { kind: 'toggle-safe-mode' }
  | { kind: 'toggle-conversion'; category: ConversionCategory }
  | { kind: 'open-setting'; settingId: string }
  | { kind: 'check-again' }
  | { kind: 'none' };

export interface ControlsQuickPickItem extends vscode.QuickPickItem {
  action?: ControlsItemAction;
}

export interface ControlsPanelDependencies {
  getConfiguration: () => Configuration;
  getSafeMode: () => SafeModeState;
  runChecks: (configuration: Configuration) => Promise<FeatureAvailabilityEntry[]>;
  writeEngine: (engine: SvgToPdfEngine) => Promise<void>;
  writeConversionEnabled: (category: ConversionCategory, enabled: boolean) => Promise<void>;
  openSetting: (settingId: string) => Promise<void>;
  createQuickPick: () => vscode.QuickPick<ControlsQuickPickItem>;
}

/** ツールバー（status bar）にアイコンのみのControlsボタンを配置する。 */
export function initializeControlsPanel(context: { subscriptions: vscode.Disposable[] }): void {
  const statusBarItem = vscode.window.createStatusBarItem(CONTROLS_STATUS_BAR_ID, vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'graphics-workbench.openControls';
  statusBarItem.tooltip = userMessage('message.controls.tooltip');
  statusBarItem.text = '$(sliders)';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export async function openControlsPanelCommand(dependencies: CommandDependencies): Promise<void> {
  const configuration = dependencies.getConfiguration();
  await showControlsPanel({
    getConfiguration: () => configuration,
    getSafeMode: getSafeModeState,
    runChecks: async (config) => runFeatureAvailabilityChecks({ configuration: config, probe: environmentProbe }),
    writeEngine: async (engine) => {
      await vscode.workspace
        .getConfiguration(extensionIdentity.configurationNamespace)
        .update('convertToPdf.svg.engine', engine, vscode.ConfigurationTarget.Global);
    },
    writeConversionEnabled: async (category, enabled) => {
      await vscode.workspace
        .getConfiguration(extensionIdentity.configurationNamespace)
        .update(`conversion.${category}.enabled`, enabled, vscode.ConfigurationTarget.Global);
    },
    openSetting: async (settingId) => {
      await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
    },
    createQuickPick: () => vscode.window.createQuickPick<ControlsQuickPickItem>(),
  });
}

/** Controlsパネル（QuickPickのポップオーバー）を表示する。 */
export async function showControlsPanel(deps: ControlsPanelDependencies): Promise<void> {
  const quickPick = deps.createQuickPick();
  const configuration = deps.getConfiguration();
  let availability: FeatureAvailabilityEntry[] | undefined;

  const refresh = (): void => {
    quickPick.items = buildControlsItems({
      engine: configuration.convertToPdf.svg.engine(),
      safeModeEnabled: deps.getSafeMode().isEnabled(),
      conversionsEnabled: {
        single: configuration.conversion.single.enabled(),
        split: configuration.conversion.split.enabled(),
        combine: configuration.conversion.combine.enabled(),
      },
      availability,
    });
  };

  const handleAction = async (action: ControlsItemAction): Promise<void> => {
    switch (action.kind) {
      case 'set-engine': {
        await deps.writeEngine(action.engine);
        break;
      }
      case 'toggle-safe-mode': {
        await deps.getSafeMode().toggle();
        break;
      }
      case 'toggle-conversion': {
        const current = configuration.conversion[action.category].enabled();
        await deps.writeConversionEnabled(action.category, !current);
        break;
      }
      case 'open-setting': {
        quickPick.hide();
        await deps.openSetting(action.settingId);
        return;
      }
      case 'check-again': {
        quickPick.busy = true;
        try {
          availability = await deps.runChecks(deps.getConfiguration());
        } finally {
          quickPick.busy = false;
        }
        break;
      }
      case 'none': {
        return;
      }
    }
    refresh();
  };

  quickPick.title = userMessage('message.controls.panelTitle');
  quickPick.canSelectMany = false;

  quickPick.onDidChangeSelection((selection) => {
    const [item] = selection;
    if (item?.action) {
      void handleAction(item.action);
    }
  });
  quickPick.onDidHide(() => {
    quickPick.dispose();
  });
  refresh();
  quickPick.show();

  // Show the panel before probing external tools. Broken or slow tool
  // installations must not make Controls look unresponsive.
  availability = await deps.runChecks(configuration);
  refresh();
}

export function buildControlsItems(state: {
  engine: SvgToPdfEngine;
  safeModeEnabled: boolean;
  conversionsEnabled: Record<ConversionCategory, boolean>;
  availability: FeatureAvailabilityEntry[] | undefined;
}): ControlsQuickPickItem[] {
  const engineRadio = (engine: SvgToPdfEngine, label: string): string =>
    state.engine === engine ? `$(circle-filled) ${label}` : `$(circle-outline) ${label}`;
  const conversionToggle = (category: ConversionCategory, label: string): ControlsQuickPickItem => ({
    label,
    description: `[${state.conversionsEnabled[category] ? userMessage('message.controls.safeModeOn') : userMessage('message.controls.safeModeOff')}]`,
    action: { kind: 'toggle-conversion', category },
  });

  return [
    { kind: vscode.QuickPickItemKind.Separator, label: userMessage('message.controls.section.tools') },
    { kind: vscode.QuickPickItemKind.Separator, label: userMessage('message.controls.section.conversions') },
    conversionToggle('single', userMessage('message.controls.conversionSingle')),
    conversionToggle('split', userMessage('message.controls.conversionSplit')),
    conversionToggle('combine', userMessage('message.controls.conversionCombine')),
    { kind: vscode.QuickPickItemKind.Separator, label: userMessage('message.controls.section.svgToPdf') },
    {
      label: engineRadio('rsvg-convert', userMessage('message.controls.engine.rsvgConvert')),
      action: { kind: 'set-engine', engine: 'rsvg-convert' },
    },
    {
      label: engineRadio('chrome', userMessage('message.controls.engine.chrome')),
      action: { kind: 'set-engine', engine: 'chrome' },
    },
    { kind: vscode.QuickPickItemKind.Separator, label: userMessage('message.controls.section.safeMode') },
    {
      label: userMessage('message.controls.section.safeMode'),
      description: state.safeModeEnabled
        ? `[${userMessage('message.controls.safeModeOn')}]`
        : `[${userMessage('message.controls.safeModeOff')}]`,
      action: { kind: 'toggle-safe-mode' },
    },
    { kind: vscode.QuickPickItemKind.Separator, label: userMessage('message.controls.section.availability') },
    ...(state.availability === undefined
      ? FEATURE_IDS.map((id): ControlsQuickPickItem => ({
          label: featureLabel(id),
          description: `$(loading~spin) ${userMessage('message.controls.availabilityChecking')}`,
          action: { kind: 'none' },
        }))
      : state.availability.map((entry): ControlsQuickPickItem => ({
          label: featureLabel(entry.id),
          description: `${entry.available ? '$(check)' : '$(close)'} ${entry.detail}`,
          detail: entry.detail,
          action:
            entry.settingId === undefined ? { kind: 'none' } : { kind: 'open-setting', settingId: entry.settingId },
        }))),
    {
      label: `$(refresh) ${userMessage('message.controls.checkAgain')}`,
      action: { kind: 'check-again' },
    },
  ];
}

const FEATURE_LABELS: Record<FeatureAvailabilityId, LocaleKeyType> = {
  'pdf-operations': 'message.controls.feature.pdfOperations',
  images: 'message.controls.feature.images',
  'svg-to-pdf': 'message.controls.feature.svgToPdf',
  drawio: 'message.controls.feature.drawio',
};

const FEATURE_IDS: readonly FeatureAvailabilityId[] = ['pdf-operations', 'images', 'svg-to-pdf', 'drawio'];

function featureLabel(id: FeatureAvailabilityId): string {
  return userMessage(FEATURE_LABELS[id]);
}
