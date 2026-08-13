import * as vscode from 'vscode';

import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

import localeJa from '../package.nls.ja.json' with { type: 'json' };
import localeEn from '../package.nls.json' with { type: 'json' };

export type LocaleKeyType = keyof typeof localeEn;

const localeTableKey = vscode.env.language;
const localeTable: Record<string, string> = {
  ...localeEn,
  ...(localeTableKey === 'ja' ? localeJa : {}),
};

const localeString = (key: string): string => localeTable[key] ?? key;
export const localeMap = (key: LocaleKeyType): string => localeString(key);

export function localeCatalog(): MessageCatalog {
  return { ...localeTable };
}
