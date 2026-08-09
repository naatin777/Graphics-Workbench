export function resolveOutputPathTemplate(template: string, defaultValue: string): string {
  return template.trim() === '' ? defaultValue : template;
}
