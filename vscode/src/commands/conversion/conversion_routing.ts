import type { Configuration } from '../../generated/extension_manifest.js';
import type { RasterConversionTarget } from '@graphics-workbench/core/conversion';

export type OutputCardinality = 'single' | 'split';

/** Resolves the raster output template from the single/split outputPath settings. */
export function resolveRasterOutputTemplate(options: {
  cardinality: OutputCardinality;
  target: RasterConversionTarget;
  configuration: Configuration;
}): string {
  const { cardinality, target, configuration } = options;
  return cardinality === 'split' ? configuration.outputPath.split[target]() : configuration.outputPath.single[target]();
}
