import type { Component, JSX } from 'solid-js';

import { isWebviewPageId, type WebviewPageId } from '@graphics-workbench/vscode-protocol/webview-page';

import { App as CropPdfPage } from './pages/crop-pdf/app';
import { App as MergePdfPage } from './pages/merge-pdf/app';
import { App as PreviewPage } from './pages/preview/app';
import { App as ReorderPdfPage } from './pages/reorder-pdf/app';
import { App as RotatePdfPage } from './pages/rotate-pdf/app';
import { App as SplitPdfPage } from './pages/split-pdf/app';
import { App as TableEditorPage } from './pages/table-editor/app';

const webviewPages = {
  'crop-pdf': CropPdfPage,
  'merge-pdf': MergePdfPage,
  preview: PreviewPage,
  'reorder-pdf': ReorderPdfPage,
  'rotate-pdf': RotatePdfPage,
  'split-pdf': SplitPdfPage,
  'table-editor': TableEditorPage,
} satisfies Record<WebviewPageId, Component>;

export function pageIdFromLocation(): WebviewPageId | undefined {
  const value = document.body.dataset.page ?? new URLSearchParams(globalThis.location.search).get('page');
  return isWebviewPageId(value) ? value : undefined;
}

export function WebviewApp(): JSX.Element {
  const pageId = pageIdFromLocation();
  if (pageId === undefined) {
    throw new Error(`Unknown webview page id: ${document.body.dataset.page ?? '<missing>'}`);
  }
  const Page = webviewPages[pageId];
  document.body.dataset.page = pageId;
  return <Page />;
}
