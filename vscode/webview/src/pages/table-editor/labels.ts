import type { MessageCatalog } from '@graphics-workbench/vscode-protocol/typed-protocol';

export interface TableEditorLabels {
  header: {
    title: string;
    description: string;
  };
  input: {
    unsupportedFile: string;
    emptyFile: string;
  };
  table: {
    addRow: string;
    addColumn: string;
    removeRow: string;
    removeColumn: string;
    alignmentLabel: string;
    alignmentLeft: string;
    alignmentCenter: string;
    alignmentRight: string;
    headerToggle: string;
  };
  options: {
    formatLabel: string;
    formatLatex: string;
    formatTypst: string;
    formatQuarkdown: string;
    booktabs: string;
  };
  preview: {
    title: string;
  };
  actions: {
    insert: string;
  };
}

export function readTableEditorLabels(catalog: MessageCatalog): TableEditorLabels {
  return {
    header: {
      title: label(catalog, 'webview.tableEditor.header.title'),
      description: label(catalog, 'webview.tableEditor.header.description'),
    },
    input: {
      unsupportedFile: label(catalog, 'webview.tableEditor.input.unsupportedFile'),
      emptyFile: label(catalog, 'webview.tableEditor.input.emptyFile'),
    },
    table: {
      addRow: label(catalog, 'webview.tableEditor.table.addRow'),
      addColumn: label(catalog, 'webview.tableEditor.table.addColumn'),
      removeRow: label(catalog, 'webview.tableEditor.table.removeRow'),
      removeColumn: label(catalog, 'webview.tableEditor.table.removeColumn'),
      alignmentLabel: label(catalog, 'webview.tableEditor.table.alignmentLabel'),
      alignmentLeft: label(catalog, 'webview.tableEditor.table.alignmentLeft'),
      alignmentCenter: label(catalog, 'webview.tableEditor.table.alignmentCenter'),
      alignmentRight: label(catalog, 'webview.tableEditor.table.alignmentRight'),
      headerToggle: label(catalog, 'webview.tableEditor.table.headerToggle'),
    },
    options: {
      formatLabel: label(catalog, 'webview.tableEditor.options.formatLabel'),
      formatLatex: label(catalog, 'webview.tableEditor.options.formatLatex'),
      formatTypst: label(catalog, 'webview.tableEditor.options.formatTypst'),
      formatQuarkdown: label(catalog, 'webview.tableEditor.options.formatQuarkdown'),
      booktabs: label(catalog, 'webview.tableEditor.options.booktabs'),
    },
    preview: {
      title: label(catalog, 'webview.tableEditor.preview.title'),
    },
    actions: {
      insert: label(catalog, 'webview.tableEditor.actions.insert'),
    },
  };
}

function label(catalog: MessageCatalog, key: string): string {
  const value = catalog[key];
  if (value === undefined) {
    throw new Error(`Table Editor label "${key}" was not provided.`);
  }
  return value;
}
