import type { ReorderPdfLabels } from '@graphics-workbench-reorder-pdf-protocol';

export const defaultLabels: ReorderPdfLabels = {
  header: {
    title: 'Reorder PDF',
    description: 'Move pages to change the output order.',
  },
  preview: {
    title: 'PDF Preview',
    ariaLabel: 'PDF page preview',
    renderError: 'Failed to render the PDF preview.',
    applyError: 'Failed to apply the reorder.',
  },
  order: {
    title: 'Order',
    moveUp: 'Move page up',
    moveDown: 'Move page down',
    positionLabel: 'pages',
  },
  validation: {
    orderRequired: 'The page order cannot be empty.',
    orderInvalid: 'The page order is invalid.',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
  },
  tooManyPages: 'Reorder is limited to 32 pages.',
};
