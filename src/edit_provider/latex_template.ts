import type * as vscode from 'vscode';

export interface TemplateContext {
  path: string;
  name: string;
  ext: string;
  page?: number;
  dir: string;
}

const DEFAULT_PDF_TEMPLATE = [
  '\\begin{figure}[H]',
  '  \\centering',
  '  \\includegraphics[width=\\linewidth]{${path}}',
  '  \\caption{${name}}',
  '  \\label{fig:${name}}',
  '\\end{figure}',
].join('\n');

const DEFAULT_IMAGE_TEMPLATE = [
  '\\begin{figure}[H]',
  '  \\centering',
  '  \\resizebox{\\linewidth}{!}{\\includegraphics{${path}}}',
  '  \\caption{${name}}',
  '  \\label{fig:${name}}',
  '\\end{figure}',
].join('\n');

export function renderTemplate(template: string, context: TemplateContext): string {
  return template
    .replaceAll('${path}', context.path)
    .replaceAll('${name}', context.name)
    .replaceAll('${ext}', context.ext)
    .replaceAll('${page}', context.page !== undefined ? String(context.page) : '1')
    .replaceAll('${dir}', context.dir);
}

export function getPdfTemplates(configuration: vscode.WorkspaceConfiguration): string[] {
  const raw = configuration.get<string | string[]>('insertLatex.pdfTemplate');
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : [DEFAULT_PDF_TEMPLATE];
  }
  return [raw === undefined || raw === '' ? DEFAULT_PDF_TEMPLATE : raw];
}

export function getImageTemplates(configuration: vscode.WorkspaceConfiguration): string[] {
  const raw = configuration.get<string | string[]>('insertLatex.imageTemplate');
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw : [DEFAULT_IMAGE_TEMPLATE];
  }
  return [raw === undefined || raw === '' ? DEFAULT_IMAGE_TEMPLATE : raw];
}
