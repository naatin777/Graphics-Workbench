import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface MergePdfLabels {
  header: {
    title: string;
  };
  sources: {
    list: string;
    count: string;
  };
  controls: {
    actions: string;
    dragHandle: string;
    moveUp: string;
    moveDown: string;
    removeSource: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    loading: string;
    renderError: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export function readMergePdfLabels(catalog: MessageCatalog): MergePdfLabels {
  return {
    header: {
      title: label(catalog, 'webview.mergePdf.title'),
    },
    sources: {
      list: label(catalog, 'webview.mergePdf.sourceList'),
      count: label(catalog, 'webview.mergePdf.sourceCount'),
    },
    controls: {
      actions: label(catalog, 'webview.mergePdf.actions'),
      dragHandle: label(catalog, 'webview.mergePdf.dragHandle'),
      moveUp: label(catalog, 'webview.mergePdf.moveUp'),
      moveDown: label(catalog, 'webview.mergePdf.moveDown'),
      removeSource: label(catalog, 'webview.mergePdf.removeSource'),
    },
    preview: {
      title: label(catalog, 'webview.mergePdf.preview'),
      ariaLabel: label(catalog, 'webview.mergePdf.previewAriaLabel'),
      loading: label(catalog, 'webview.mergePdf.previewLoading'),
      renderError: label(catalog, 'webview.mergePdf.previewRenderError'),
    },
    actions: {
      apply: label(catalog, 'webview.mergePdf.apply'),
      cancel: label(catalog, 'webview.mergePdf.cancel'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Merge PDF label "${key}" was not provided.`);
  }
  return value;
}
