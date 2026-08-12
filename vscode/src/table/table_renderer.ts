import { escapeLatex } from '../edit_provider/latex_escape.js';
import type { TableAlignment, TableModel, TableRow } from './table_model.js';

export interface LatexTableRenderOptions {
  booktabs: boolean;
}

const LATEX_ALIGNMENT: Readonly<Record<TableAlignment, string>> = {
  left: 'l',
  center: 'c',
  right: 'r',
};

const QUARKDOWN_DELIMITER: Readonly<Record<TableAlignment, string>> = {
  left: ':---',
  center: ':---:',
  right: '---:',
};

export function renderLatexTable(model: TableModel, options: LatexTableRenderOptions): string {
  const columnSpec = model.columns.map((column) => LATEX_ALIGNMENT[column.alignment]).join('');
  const headerRows = model.rows.slice(0, model.headerRows);
  const bodyRows = model.rows.slice(model.headerRows);
  const lines: string[] = [`\\begin{tabular}{${columnSpec}}`];
  lines.push(options.booktabs ? '\\toprule' : '\\hline');
  for (const row of headerRows) {
    lines.push(`${renderLatexRow(row)} \\\\`);
  }
  if (headerRows.length > 0) {
    lines.push(options.booktabs ? '\\midrule' : '\\hline');
  }
  for (const row of bodyRows) {
    lines.push(`${renderLatexRow(row)} \\\\`);
  }
  lines.push(options.booktabs ? '\\bottomrule' : '\\hline');
  lines.push('\\end{tabular}');
  return lines.join('\n');
}

function renderLatexRow(row: TableRow): string {
  return row.cells.map((cell) => escapeLatex(cell.text)).join(' & ');
}

export function renderTypstTable(model: TableModel): string {
  const headerRows = model.rows.slice(0, model.headerRows);
  const bodyRows = model.rows.slice(model.headerRows);
  const lines: string[] = ['#table('];
  lines.push(`  columns: (${model.columns.map(() => 'auto').join(', ')}),`);
  lines.push(`  align: (${model.columns.map((column) => column.alignment).join(', ')}),`);
  for (const row of headerRows) {
    lines.push(`  table.header(${renderTypstRow(row, true)}),`);
  }
  for (const row of bodyRows) {
    lines.push(`  ${renderTypstRow(row, false)},`);
  }
  lines.push(')');
  return lines.join('\n');
}

function renderTypstRow(row: TableRow, isHeader: boolean): string {
  return row.cells
    .map((cell) =>
      isHeader ? `[*#text("${escapeTypstTableCell(cell.text)}")*]` : `[#text("${escapeTypstTableCell(cell.text)}")]`,
    )
    .join(', ');
}

export function renderQuarkdownTable(model: TableModel): string {
  const headerCells = model.headerRows > 0 ? (model.rows[0]?.cells ?? []) : model.columns.map(() => ({ text: '' }));
  const bodyRows = model.rows.slice(model.headerRows);
  const lines: string[] = [];
  lines.push(`| ${headerCells.map((cell) => escapePipeTableCell(cell.text)).join(' | ')} |`);
  lines.push(`| ${model.columns.map((column) => QUARKDOWN_DELIMITER[column.alignment]).join(' | ')} |`);
  for (const row of bodyRows) {
    lines.push(`| ${row.cells.map((cell) => escapePipeTableCell(cell.text)).join(' | ')} |`);
  }
  return lines.join('\n');
}

const TYPST_STRING_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/** Keeps plain table data inside a Typst string instead of letting markup parse it. */
export function escapeTypstTableCell(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      TYPST_STRING_ESCAPES[character] ??
      (codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f) ? `\\u{${codePoint.toString(16)}}` : character)
    );
  }).join('');
}

/** Escapes Markdown/Quarkdown table syntax while preserving line breaks as explicit breaks. */
export function escapePipeTableCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('*', '\\*')
    .replaceAll('_', '\\_')
    .replaceAll('~', '\\~')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '\\<')
    .replaceAll('>', '\\>')
    .replaceAll(/\r\n|\r|\n/gu, '<br>');
}
