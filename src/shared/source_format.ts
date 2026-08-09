import path from 'node:path';

export type SourceFormat =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'tiff'
  | 'svg'
  | 'mermaid'
  | 'drawio'
  | 'editable-drawio-png'
  | 'editable-drawio-svg'
  | 'excalidraw';

export function sourceFormatForPath(sourcePath: string): SourceFormat | undefined {
  const lowerSourcePath = sourcePath.toLowerCase();
  const drawioFormat = drawioFormatForPath(lowerSourcePath);
  if (drawioFormat !== undefined) {
    return drawioFormat;
  }

  return sourceFormatForExtension(path.extname(lowerSourcePath));
}

function drawioFormatForPath(sourcePath: string): SourceFormat | undefined {
  if (sourcePath.endsWith('.drawio.png') || sourcePath.endsWith('.dio.png')) {
    return 'editable-drawio-png';
  }
  if (sourcePath.endsWith('.drawio.svg') || sourcePath.endsWith('.dio.svg')) {
    return 'editable-drawio-svg';
  }
  if (sourcePath.endsWith('.drawio') || sourcePath.endsWith('.dio')) {
    return 'drawio';
  }

  return undefined;
}

function sourceFormatForExtension(extension: string): SourceFormat | undefined {
  switch (extension) {
    case '.pdf': {
      return 'pdf';
    }
    case '.png': {
      return 'png';
    }
    case '.jpg':
    case '.jpeg': {
      return 'jpeg';
    }
    case '.webp': {
      return 'webp';
    }
    case '.avif': {
      return 'avif';
    }
    case '.gif': {
      return 'gif';
    }
    case '.tif':
    case '.tiff': {
      return 'tiff';
    }
    case '.svg': {
      return 'svg';
    }
    case '.mmd':
    case '.mermaid': {
      return 'mermaid';
    }
    case '.excalidraw': {
      return 'excalidraw';
    }
    default: {
      return undefined;
    }
  }
}

export function isRasterImagePath(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return (
    format === 'png' ||
    format === 'jpeg' ||
    format === 'webp' ||
    format === 'avif' ||
    format === 'gif' ||
    format === 'tiff'
  );
}

export function isSupportedImageInputPath(sourcePath: string): boolean {
  return isRasterImagePath(sourcePath);
}

export function isSameSourceFormat(sourcePath: string, outputExtension: string): boolean {
  const sourceFormat = sourceFormatForPath(sourcePath);
  const normalizedExtension = outputExtension.toLowerCase().replace(/^\./u, '');
  let outputFormat = normalizedExtension;
  if (normalizedExtension === 'jpg' || normalizedExtension === 'jpeg') {
    outputFormat = 'jpeg';
  } else if (normalizedExtension === 'tif' || normalizedExtension === 'tiff') {
    outputFormat = 'tiff';
  }

  return sourceFormat === outputFormat;
}

export function isMermaidPath(sourcePath: string): boolean {
  return sourceFormatForPath(sourcePath) === 'mermaid';
}

export function isEditableDrawioImagePath(sourcePath: string): boolean {
  const format = sourceFormatForPath(sourcePath);
  return format === 'editable-drawio-png' || format === 'editable-drawio-svg';
}

export function isNativeDrawioPath(sourcePath: string): boolean {
  return sourceFormatForPath(sourcePath) === 'drawio';
}

export function isExcalidrawPath(sourcePath: string): boolean {
  return sourceFormatForPath(sourcePath) === 'excalidraw';
}

export function isDrawioPath(sourcePath: string): boolean {
  return isNativeDrawioPath(sourcePath) || isEditableDrawioImagePath(sourcePath);
}

export function logicalSourcePathForOutputTemplate(sourcePath: string): string {
  if (!isEditableDrawioImagePath(sourcePath)) {
    return sourcePath;
  }

  return sourcePath.replace(/\.(drawio|dio)\.(png|svg)$/i, '');
}
