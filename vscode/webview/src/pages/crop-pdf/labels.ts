import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface CropPdfLabels {
  header: {
    title: string;
    description: string;
    pageLabel: string;
    pages: string;
  };
  preview: {
    title: string;
    ariaLabel: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    renderError: string;
    applyError: string;
  };
  cropBox: {
    settingsLabel: string;
    title: string;
    left: string;
    bottom: string;
    right: string;
    top: string;
    currentPageSize: string;
  };
  targetPages: {
    applyTo: string;
    all: string;
    pages: string;
    inputLabel: string;
    placeholder: string;
  };
  validation: {
    cropBoxNumber: string;
    cropBoxSize: string;
    pagesRequired: string;
    pageWholeNumber: string;
    pageOutOfRange: string;
  };
  actions: {
    apply: string;
    processing: string;
    cancel: string;
  };
}

export function readCropPdfLabels(catalog: MessageCatalog): CropPdfLabels {
  return {
    header: {
      title: label(catalog, 'webview.cropPdf.title'),
      description: label(catalog, 'webview.cropPdf.description'),
      pageLabel: label(catalog, 'webview.cropPdf.pageLabel'),
      pages: label(catalog, 'webview.cropPdf.pages'),
    },
    preview: {
      title: label(catalog, 'webview.cropPdf.preview'),
      ariaLabel: label(catalog, 'webview.cropPdf.previewAriaLabel'),
      zoomLabel: label(catalog, 'webview.cropPdf.previewZoom'),
      zoomOut: label(catalog, 'webview.cropPdf.zoomOut'),
      zoomIn: label(catalog, 'webview.cropPdf.zoomIn'),
      renderError: label(catalog, 'webview.cropPdf.previewRenderError'),
      applyError: label(catalog, 'webview.cropPdf.previewApplyError'),
    },
    cropBox: {
      settingsLabel: label(catalog, 'webview.cropPdf.cropSettings'),
      title: label(catalog, 'webview.cropPdf.cropBox'),
      left: label(catalog, 'webview.cropPdf.left'),
      bottom: label(catalog, 'webview.cropPdf.bottom'),
      right: label(catalog, 'webview.cropPdf.right'),
      top: label(catalog, 'webview.cropPdf.top'),
      currentPageSize: label(catalog, 'webview.cropPdf.currentPageSize'),
    },
    targetPages: {
      applyTo: label(catalog, 'webview.cropPdf.applyTo'),
      all: label(catalog, 'webview.cropPdf.allPages'),
      pages: label(catalog, 'webview.cropPdf.pages'),
      inputLabel: label(catalog, 'webview.cropPdf.pagesInput'),
      placeholder: label(catalog, 'webview.cropPdf.pagesPlaceholder'),
    },
    validation: {
      cropBoxNumber: label(catalog, 'webview.cropPdf.cropBoxNumberError'),
      cropBoxSize: label(catalog, 'webview.cropPdf.cropBoxSizeError'),
      pagesRequired: label(catalog, 'webview.cropPdf.pagesRequiredError'),
      pageWholeNumber: label(catalog, 'webview.cropPdf.pageWholeNumberError'),
      pageOutOfRange: label(catalog, 'webview.cropPdf.pageOutOfRangeError'),
    },
    actions: {
      apply: label(catalog, 'webview.cropPdf.apply'),
      processing: label(catalog, 'webview.cropPdf.processing'),
      cancel: label(catalog, 'webview.cropPdf.cancel'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Crop PDF label "${key}" was not provided.`);
  }
  return value;
}
