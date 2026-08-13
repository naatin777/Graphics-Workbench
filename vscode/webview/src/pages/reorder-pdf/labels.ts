import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface ReorderPdfLabels {
  header: {
    title: string;
    description: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    renderError: string;
    applyError: string;
  };
  order: {
    title: string;
    moveUp: string;
    moveDown: string;
    positionLabel: string;
  };
  validation: {
    orderRequired: string;
    orderInvalid: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export function readReorderPdfLabels(catalog: MessageCatalog): ReorderPdfLabels {
  return {
    header: {
      title: label(catalog, 'webview.reorderPdf.title'),
      description: label(catalog, 'webview.reorderPdf.description'),
    },
    preview: {
      title: label(catalog, 'webview.reorderPdf.preview'),
      ariaLabel: label(catalog, 'webview.reorderPdf.previewAriaLabel'),
      renderError: label(catalog, 'webview.reorderPdf.previewRenderError'),
      applyError: label(catalog, 'webview.reorderPdf.previewApplyError'),
    },
    order: {
      title: label(catalog, 'webview.reorderPdf.order'),
      moveUp: label(catalog, 'webview.reorderPdf.moveUp'),
      moveDown: label(catalog, 'webview.reorderPdf.moveDown'),
      positionLabel: label(catalog, 'webview.reorderPdf.positionLabel'),
    },
    validation: {
      orderRequired: label(catalog, 'webview.reorderPdf.orderRequiredError'),
      orderInvalid: label(catalog, 'webview.reorderPdf.orderInvalid'),
    },
    actions: {
      apply: label(catalog, 'webview.reorderPdf.apply'),
      cancel: label(catalog, 'webview.reorderPdf.cancel'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Reorder PDF label "${key}" was not provided.`);
  }
  return value;
}
