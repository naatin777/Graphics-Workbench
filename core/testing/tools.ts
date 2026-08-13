import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  createPdfRenderBackend,
  executeDrawio,
  type DrawioBackend,
  type PdfRenderBackend,
} from '@graphics-workbench/core/conversion';

export const defaultRasterMaxInputPixels = 268_402_689;

export interface ConfiguredConversionTools {
  pdfRenderTools: PdfRenderBackend;
  rsvgConvertPath: string;
  drawioTools: DrawioBackend;
}

export function readConfiguredConversionTools(): ConfiguredConversionTools {
  return {
    pdfRenderTools: createPdfRenderBackend(),
    rsvgConvertPath: resolveToolPath('GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH', 'rsvg-convert') ?? '',
    drawioTools: {
      drawioPath: resolveToolPath('GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH', 'drawio') ?? '',
      runDrawio: executeDrawio,
    },
  };
}

function resolveToolPath(environmentVariable: string, command: string): string | undefined {
  const configured = process.env[environmentVariable];
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  if (process.platform === 'darwin' && command === 'drawio') {
    const appPath = '/Applications/draw.io.app/Contents/MacOS/draw.io';
    if (existsSync(appPath)) {
      return appPath;
    }
  }
  return findOnPath(command);
}

function findOnPath(command: string): string | undefined {
  const pathValue = process.env.PATH ?? '';
  const executableExtensions = executableExtensionsFor(process.platform);
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory === '') {
      continue;
    }
    for (const extension of executableExtensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function executableExtensionsFor(platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') {
    return [''];
  }
  const pathExt = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return ['', ...pathExt.split(';').map((extension) => extension.toLowerCase())];
}
