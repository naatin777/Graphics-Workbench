import type { TerminalUiRasterTarget } from './conversion_adapter.js';

export const terminalUiDefaults = {
  maxInputPixels: 268_402_689,
  webpEffort: 4,
  outputTemplate: {
    png: '${fileDirname}/${fileBasenameNoExtension}/${page}.png',
    jpeg: '${fileDirname}/${fileBasenameNoExtension}/${page}.jpeg',
    webp: '${fileDirname}/${fileBasenameNoExtension}/${page}.webp',
  } satisfies Record<TerminalUiRasterTarget, string>,
} as const;
