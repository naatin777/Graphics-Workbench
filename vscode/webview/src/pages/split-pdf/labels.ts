import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface SplitPdfLabels {
  header: {
    title: string;
    description: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    renderError: string;
    applyError: string;
    allPages: string;
    focusedPages: string;
    zoom: string;
  };
  groups: {
    title: string;
    label: string;
    add: string;
    remove: string;
    drag: string;
    outputOrder: string;
  };
  pages: {
    title: string;
    label: string;
    placeholder: string;
  };
  output: {
    name: string;
    namePlaceholder: string;
    path: string;
  };
  validation: {
    pagesRequired: string;
    pageWholeNumber: string;
    pageOutOfRange: string;
    invalidPages: string;
    descendingPages: string;
    outputNameEmpty: string;
    outputNamePath: string;
    outputNameDuplicate: string;
  };
  actions: {
    apply: string;
    cancel: string;
    moveUp: string;
    moveDown: string;
  };
}

export function readSplitPdfLabels(catalog: MessageCatalog): SplitPdfLabels {
  return {
    header: {
      title: label(catalog, 'webview.splitPdf.title'),
      description: label(catalog, 'webview.splitPdf.description'),
    },
    preview: {
      title: label(catalog, 'webview.splitPdf.preview'),
      ariaLabel: label(catalog, 'webview.splitPdf.previewAriaLabel'),
      renderError: label(catalog, 'webview.splitPdf.previewRenderError'),
      applyError: label(catalog, 'webview.splitPdf.previewApplyError'),
      allPages: label(catalog, 'webview.splitPdf.allPages'),
      focusedPages: label(catalog, 'webview.splitPdf.focusedPages'),
      zoom: label(catalog, 'webview.splitPdf.zoom'),
    },
    groups: {
      title: label(catalog, 'webview.splitPdf.groups'),
      label: label(catalog, 'webview.splitPdf.groupLabel'),
      add: label(catalog, 'webview.splitPdf.addGroup'),
      remove: label(catalog, 'webview.splitPdf.removeGroup'),
      drag: label(catalog, 'webview.splitPdf.dragGroup'),
      outputOrder: label(catalog, 'webview.splitPdf.outputOrder'),
    },
    pages: {
      title: label(catalog, 'webview.splitPdf.pages'),
      label: label(catalog, 'webview.splitPdf.pageLabel'),
      placeholder: label(catalog, 'webview.splitPdf.pagesPlaceholder'),
    },
    output: {
      name: label(catalog, 'webview.splitPdf.outputName'),
      namePlaceholder: label(catalog, 'webview.splitPdf.outputNamePlaceholder'),
      path: label(catalog, 'webview.splitPdf.outputPath'),
    },
    validation: {
      pagesRequired: label(catalog, 'webview.splitPdf.pagesRequiredError'),
      pageWholeNumber: label(catalog, 'webview.splitPdf.pageWholeNumberError'),
      pageOutOfRange: label(catalog, 'webview.splitPdf.pageOutOfRangeError'),
      invalidPages: label(catalog, 'webview.splitPdf.invalidPages'),
      descendingPages: label(catalog, 'webview.splitPdf.descendingPages'),
      outputNameEmpty: label(catalog, 'webview.splitPdf.outputNameEmpty'),
      outputNamePath: label(catalog, 'webview.splitPdf.outputNamePath'),
      outputNameDuplicate: label(catalog, 'webview.splitPdf.outputNameDuplicate'),
    },
    actions: {
      apply: label(catalog, 'webview.splitPdf.apply'),
      cancel: label(catalog, 'webview.splitPdf.cancel'),
      moveUp: label(catalog, 'webview.splitPdf.moveUp'),
      moveDown: label(catalog, 'webview.splitPdf.moveDown'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Split PDF label "${key}" was not provided.`);
  }
  return value;
}
