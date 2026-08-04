import { conversionPairs, getDefaultConfiguration, type Configuration } from '../../generated/extension_manifest.js';
import { type SourceFormat, sourceFormatForPath } from '../../application/policy/source_format.js';
import { resolveOutputPathTemplate, resolveOutputPathsTemplate } from '../../config/output/output_path_settings.js';

type ConversionTarget = 'png' | 'jpeg' | 'webp' | 'avif' | 'gif' | 'tiff' | 'svg' | 'eps' | 'pdf';

export interface ResolveConversionTemplateOptions {
  target: ConversionTarget;
  sourcePath: string;
  configuration: Configuration;
  defaultConfiguration?: Configuration;
  pluralFallback?: string;
  splitDefault?: string;
}

/** Resolves the output template for a conversion pair derived from package.json. */
export function resolveConversionTemplate(options: ResolveConversionTemplateOptions): string {
  const { target, sourcePath, configuration, pluralFallback, splitDefault } = options;
  const defaultConfiguration = options.defaultConfiguration ?? getDefaultConfiguration();
  const source = conversionSource(sourceFormatForPath(sourcePath));
  const pluralPair = conversionPairs.plural.find(
    (candidate) => candidate.target === target && candidate.source === source,
  );
  const flatPair = conversionPairs.flat.find((candidate) => candidate.target === target && candidate.source === source);

  if (pluralPair !== undefined) {
    const pluralTemplate = resolveOutputPathsTemplate(configuration, pluralPair.setting, '');

    if (pluralTemplate !== '') {
      return pluralTemplate;
    }

    if (splitDefault !== undefined) {
      return splitDefault;
    }

    if (pluralFallback !== undefined) {
      return pluralFallback;
    }

    if (flatPair !== undefined) {
      return resolveOutputPathTemplate(
        configuration.outputPath[flatPair.setting](),
        defaultConfiguration.outputPath[flatPair.setting](),
      );
    }

    throw new Error(`Missing output template for ${pluralPair.setting}`);
  }

  if (splitDefault !== undefined) {
    return splitDefault;
  }

  if (flatPair !== undefined) {
    return resolveOutputPathTemplate(
      configuration.outputPath[flatPair.setting](),
      defaultConfiguration.outputPath[flatPair.setting](),
    );
  }

  throw new Error(`Unsupported ${target} input format: ${sourcePath}`);
}

function conversionSource(format: SourceFormat | undefined): string | undefined {
  if (format === 'editable-drawio-png' || format === 'editable-drawio-svg') {
    return 'drawio';
  }

  return format;
}
