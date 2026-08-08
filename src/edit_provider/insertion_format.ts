import type * as vscode from 'vscode';

export type InsertionFormat = 'latex' | 'typst' | 'quarkdown';

export const insertionDocumentSelectors: Readonly<Record<InsertionFormat, vscode.DocumentSelector>> = {
  latex: [{ language: 'latex' }, { language: 'tex' }],
  typst: [{ language: 'typst' }],
  quarkdown: [{ language: 'quarkdown' }],
};

export const insertionFormats: readonly InsertionFormat[] = ['latex', 'typst', 'quarkdown'];
