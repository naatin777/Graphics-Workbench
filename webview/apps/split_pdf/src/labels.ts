import type { SplitPdfLabels } from '@graphics-workbench-split-pdf-protocol';

export const defaultLabels: SplitPdfLabels = {
  header: {
    title: 'Split PDF',
    description: 'Select pages and assign an output name to each group.',
  },
  preview: {
    title: 'Preview',
    description: 'Preview the selected pages.',
    ariaLabel: 'PDF preview',
    renderError: 'Could not display the PDF',
    applyError: 'PDF preview must render before applying.',
    allPages: 'All pages',
    focusedPages: 'Focused',
    zoom: 'Preview zoom',
  },
  groups: {
    title: 'Groups',
    label: 'Group',
    add: 'Add group',
    remove: 'Remove group',
    drag: 'Drag group',
    outputOrder: 'Output order',
  },
  pages: {
    title: 'Pages',
    label: 'Page',
    placeholder: 'Example: 1, 3-6, 10-',
  },
  output: {
    name: 'Output name',
    namePlaceholder: 'group-1',
    path: 'Output path',
  },
  validation: {
    pagesRequired: 'At least one page must be selected.',
    pageWholeNumber: 'Page must be a whole number: {0}',
    pageOutOfRange: 'Selected page is out of range: {0}',
    invalidPages: 'Invalid page expression: {0}',
    descendingPages: 'Page range must ascend: {0}',
    outputNameEmpty: 'Output name cannot be empty.',
    outputNamePath: 'Output name must not contain path separators or .. .',
    outputNameDuplicate: 'Output name is duplicated: {0}',
  },
  actions: {
    apply: 'Apply',
    cancel: 'Cancel',
    moveUp: 'Move up',
    moveDown: 'Move down',
  },
};
