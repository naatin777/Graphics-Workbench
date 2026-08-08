import { getExtensionConfiguration } from '../config/extension_configuration.js';
import type { InsertionFormat } from './insertion_format.js';

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

export function getPdfTemplates(format: InsertionFormat): string[] {
  return readTemplates(format, 'pdf');
}

export function getImageTemplates(format: InsertionFormat): string[] {
  return readTemplates(format, 'image');
}

function readTemplates(format: InsertionFormat, kind: 'pdf' | 'image'): string[] {
  const configuration = getExtensionConfiguration();
  let section: {
    pdfTemplate: () => string | string[];
    imageTemplate: () => string | string[];
  };
  if (format === 'latex') {
    section = configuration.insertLatex;
  } else if (format === 'typst') {
    section = configuration.insertTypst;
  } else {
    section = configuration.insertQuarkdown;
  }
  const raw = kind === 'pdf' ? section.pdfTemplate() : section.imageTemplate();
  return typeof raw === 'string' ? [raw] : raw;
}
