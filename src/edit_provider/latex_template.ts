import { getExtensionConfiguration } from '../config/extension_configuration.js';

export interface TemplateContext {
  path: string;
  name: string;
  ext: string;
  page?: number;
  dir: string;
}

export function renderTemplate(template: string, context: TemplateContext): string {
  return template
    .replaceAll('${path}', context.path)
    .replaceAll('${name}', context.name)
    .replaceAll('${ext}', context.ext)
    .replaceAll('${page}', context.page === undefined ? '1' : String(context.page))
    .replaceAll('${dir}', context.dir);
}

export function getPdfTemplates(): string[] {
  const raw = getExtensionConfiguration().insertLatex.pdfTemplate();
  return typeof raw === 'string' ? [raw] : raw;
}

export function getImageTemplates(): string[] {
  const raw = getExtensionConfiguration().insertLatex.imageTemplate();
  return typeof raw === 'string' ? [raw] : raw;
}
