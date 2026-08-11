export type TableAlignment = 'left' | 'center' | 'right';

interface TableCell {
  text: string;
}

export interface TableRow {
  cells: TableCell[];
}

interface TableColumn {
  alignment: TableAlignment;
}

export interface TableModel {
  rows: TableRow[];
  columns: TableColumn[];
  headerRows: number;
}

export function createTableModel(rowCount: number, columnCount: number, headerRows: number): TableModel {
  const columns = Array.from({ length: columnCount }, () => ({ alignment: 'left' as const }));
  const rows = Array.from({ length: rowCount }, () => ({
    cells: Array.from({ length: columnCount }, () => ({ text: '' })),
  }));
  return { rows, columns, headerRows };
}

/** CSV / TSVの区切り行をTableModelへ変換し、列数のずれを空セルで補完する。 */
export function tableModelFromRows(rows: readonly (readonly string[])[], headerRows: number): TableModel {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    rows: rows.map((row) => ({
      cells: Array.from({ length: columnCount }, (_unused, columnIndex) => ({ text: row[columnIndex] ?? '' })),
    })),
    columns: Array.from({ length: columnCount }, () => ({ alignment: 'left' as const })),
    headerRows,
  };
}

export function updateCellText(model: TableModel, rowIndex: number, columnIndex: number, text: string): TableModel {
  return {
    ...model,
    rows: model.rows.map((row, index) => {
      if (index !== rowIndex) {
        return row;
      }
      return {
        cells: row.cells.map((cell, cellIndex) => (cellIndex === columnIndex ? { text } : cell)),
      };
    }),
  };
}

export function addTableRow(model: TableModel): TableModel {
  return {
    ...model,
    rows: [...model.rows, { cells: model.columns.map(() => ({ text: '' })) }],
  };
}

export function removeTableRow(model: TableModel, rowIndex: number): TableModel {
  return {
    ...model,
    rows: model.rows.filter((_row, index) => index !== rowIndex),
  };
}

export function addTableColumn(model: TableModel): TableModel {
  return {
    ...model,
    columns: [...model.columns, { alignment: 'left' as const }],
    rows: model.rows.map((row) => ({ cells: [...row.cells, { text: '' }] })),
  };
}

export function removeTableColumn(model: TableModel, columnIndex: number): TableModel {
  return {
    ...model,
    columns: model.columns.filter((_column, index) => index !== columnIndex),
    rows: model.rows.map((row) => ({
      cells: row.cells.filter((_cell, index) => index !== columnIndex),
    })),
  };
}

export function setColumnAlignment(model: TableModel, columnIndex: number, alignment: TableAlignment): TableModel {
  return {
    ...model,
    columns: model.columns.map((column, index) => (index === columnIndex ? { alignment } : column)),
  };
}

export function setHeaderRows(model: TableModel, headerRows: number): TableModel {
  return { ...model, headerRows };
}
