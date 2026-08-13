import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface RotatePdfLabels {
  header: {
    title: string;
    description: string;
  };
  preview: {
    title: string;
    description: string;
    ariaLabel: string;
    renderError: string;
    applyError: string;
  };
  rotation: {
    title: string;
    angleLabel: string;
    selectAll: string;
    selectAllAriaLabel: string;
    pageToggle: string;
  };
  validation: {
    pagesRequired: string;
    pageOutOfRange: string;
    angleInvalid: string;
  };
  actions: {
    apply: string;
    cancel: string;
  };
}

export function readRotatePdfLabels(catalog: MessageCatalog): RotatePdfLabels {
  return {
    header: {
      title: label(catalog, 'webview.rotatePdf.title'),
      description: label(catalog, 'webview.rotatePdf.description'),
    },
    preview: {
      title: label(catalog, 'webview.rotatePdf.preview'),
      description: label(catalog, 'webview.rotatePdf.previewDescription'),
      ariaLabel: label(catalog, 'webview.rotatePdf.previewAriaLabel'),
      renderError: label(catalog, 'webview.rotatePdf.previewRenderError'),
      applyError: label(catalog, 'webview.rotatePdf.previewApplyError'),
    },
    rotation: {
      title: label(catalog, 'webview.rotatePdf.rotation'),
      angleLabel: label(catalog, 'webview.rotatePdf.angleLabel'),
      selectAll: label(catalog, 'webview.rotatePdf.selectAll'),
      selectAllAriaLabel: label(catalog, 'webview.rotatePdf.selectAllAriaLabel'),
      pageToggle: label(catalog, 'webview.rotatePdf.pageToggle'),
    },
    validation: {
      pagesRequired: label(catalog, 'webview.rotatePdf.pagesRequiredError'),
      pageOutOfRange: label(catalog, 'webview.rotatePdf.pageOutOfRangeError'),
      angleInvalid: label(catalog, 'webview.rotatePdf.angleInvalid'),
    },
    actions: {
      apply: label(catalog, 'webview.rotatePdf.apply'),
      cancel: label(catalog, 'webview.rotatePdf.cancel'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Rotate PDF label "${key}" was not provided.`);
  }
  return value;
}
