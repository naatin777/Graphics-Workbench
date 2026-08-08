import * as vscode from 'vscode';

import type { OutputConflictDecision } from '../../operations/lifecycle/commit_conversion_outputs.js';

import { userMessage } from '../shared/user_messages.js';

const SAFE_MODE_STATE_KEY = 'safeMode.enabled';

export interface StateStorage {
  get(key: 'safeMode.enabled', defaultValue?: boolean): boolean | undefined;
  update(key: 'safeMode.enabled', value: boolean): Thenable<void>;
}

export class SafeModeState {
  constructor(private readonly storage: StateStorage) {}

  isEnabled(): boolean {
    return this.storage.get(SAFE_MODE_STATE_KEY, true) ?? true;
  }

  async toggle(): Promise<boolean> {
    const enabled = !this.isEnabled();
    await this.storage.update(SAFE_MODE_STATE_KEY, enabled);
    return enabled;
  }
}

let safeModeState: SafeModeState | undefined;

type SafeModeContext = {
  globalState: StateStorage;
};

export function initializeSafeMode(context: SafeModeContext): void {
  safeModeState = new SafeModeState(context.globalState);
}

export async function toggleSafeModeCommand(): Promise<void> {
  await requireSafeModeState().toggle();
}

export function getSafeModeState(): SafeModeState {
  return requireSafeModeState();
}

export async function resolveOutputConflicts(conflicts: string[]): Promise<OutputConflictDecision> {
  if (!requireSafeModeState().isEnabled()) {
    return 'overwrite';
  }

  const keepBoth = userMessage('message.safeMode.keepBoth');
  const overwrite = userMessage('message.safeMode.overwrite');
  const selected = await vscode.window.showWarningMessage(
    userMessage('message.safeMode.conflicts', conflicts.length),
    { modal: true },
    { title: keepBoth },
    {
      title: userMessage('message.safeMode.doNotOverwrite'),
      isCloseAffordance: true,
    },
    { title: overwrite },
  );

  if (selected?.title === keepBoth) {
    return 'keep-both';
  }

  if (selected?.title === overwrite) {
    return 'overwrite';
  }

  return 'cancel';
}

function requireSafeModeState(): SafeModeState {
  if (!safeModeState) {
    throw new Error('Safe Mode has not been initialized.');
  }

  return safeModeState;
}
