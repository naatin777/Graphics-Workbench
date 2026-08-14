import * as vscode from 'vscode';

import type { ConversionConfiguration, ConversionSource } from '@graphics-workbench/core/conversion';
import type { Configuration } from '../../generated/extension_manifest.js';
import { resolveChromeExecutablePath } from '../../config/rendering/chrome_cli_options.js';

/** Converts the VS Code {@link Configuration} into the core {@link ConversionConfiguration}. */
export function toConversionConfiguration(configuration: Configuration): ConversionConfiguration {
  const conversionConfig: ConversionConfiguration = {
    maxInputPixels: configuration.raster.maxInputPixels(),
    maxAnimationPixels: configuration.raster.maxAnimationPixels(),
    platform: process.platform,
    svgToPdf: {
      engine: configuration.convertToPdf.svg.engine(),
      rsvgConvertPath: configuration.execPath.rsvgConvert(),
      chromePath: resolveChromeExecutablePath(configuration),
    },
    drawioPath: configuration.execPath.drawio(),
    avifEffort: configuration.convertToAvif.effort(),
    webpEffort: configuration.convertToWebp.effort(),
  };
  return conversionConfig;
}

/** Converts VS Code file URIs into core {@link ConversionSource}s with workspace context. */
export function toConversionSources(sourceUris: vscode.Uri[]): ConversionSource[] {
  const sources: ConversionSource[] = [];
  for (const sourceUri of sourceUris) {
    if (sourceUri.scheme !== 'file') {
      throw new Error(`Only local files are supported: ${sourceUri.toString()}`);
    }
    const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
    if (!workspace) {
      throw new Error(`The file must be inside an open workspace: ${sourceUri.fsPath}`);
    }
    sources.push({
      sourcePath: sourceUri.fsPath,
      workspacePath: workspace.uri.fsPath,
      workspaceName: workspace.name,
    });
  }
  return sources;
}
