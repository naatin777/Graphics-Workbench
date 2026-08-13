import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface PreviewLabels {
  title: string;
  description: string;
  page: {
    label: string;
    pages: string;
  };
  preview: {
    ariaLabel: string;
    zoomLabel: string;
    zoomOut: string;
    zoomIn: string;
    renderError: string;
  };
}

export function readPreviewLabels(catalog: MessageCatalog): PreviewLabels {
  return {
    title: label(catalog, 'webview.preview.title'),
    description: label(catalog, 'webview.preview.description'),
    page: {
      label: label(catalog, 'webview.preview.pageLabel'),
      pages: label(catalog, 'webview.preview.pages'),
    },
    preview: {
      ariaLabel: label(catalog, 'webview.preview.previewAriaLabel'),
      zoomLabel: label(catalog, 'webview.preview.zoomLabel'),
      zoomOut: label(catalog, 'webview.preview.zoomOut'),
      zoomIn: label(catalog, 'webview.preview.zoomIn'),
      renderError: label(catalog, 'webview.preview.renderError'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Preview label "${key}" was not provided.`);
  }
  return value;
}
