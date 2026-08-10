import { conversionPairs, type Configuration } from '../../generated/extension_manifest.js';
import { type SourceFormat, sourceFormatForPath } from '../../shared/source_format.js';
import { resolveOutputPathTemplate } from '../../config/output/output_path_settings.js';

type ConversionTarget = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff' | 'svg' | 'pdf';

export interface ResolveConversionTemplateOptions {
  target: ConversionTarget;
  sourcePath: string;
  configuration: Configuration;
  templateOverride?: string;
}

/** Resolves the output template for a conversion pair derived from package.json. */
export function resolveConversionTemplate(options: ResolveConversionTemplateOptions): string {
  const { target, sourcePath, configuration, templateOverride } = options;
  if (templateOverride !== undefined) {
    return templateOverride;
  }

  const source = conversionSource(sourceFormatForPath(sourcePath));
  const pair = conversionPairs.find((candidate) => candidate.target === target && candidate.source === source);

  if (pair !== undefined) {
    return resolveOutputPathTemplate(configuration.outputPath[pair.setting](), pair.defaultValue);
  }

  throw new Error(`Unsupported ${target} input format: ${sourcePath}`);
}

function conversionSource(format: SourceFormat | undefined): string | undefined {
  if (format === 'editable-drawio-png' || format === 'editable-drawio-svg') {
    return 'drawio';
  }

  return format;
}
