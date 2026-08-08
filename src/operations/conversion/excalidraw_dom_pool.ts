import { JSDOM } from 'jsdom';

const domHtml = '<!doctype html><html><head></head><body></body></html>';
const domUrl = 'https://graphics-workbench.local/';

export interface ExcalidrawDomInstance {
  dom: JSDOM;
  healthy: boolean;
}

/**
 * A small pool of persistent jsdom windows for @excalidraw/excalidraw.
 *
 * exportToSvg() resolves browser globals at call time, so installing them for
 * one conversion and restoring them afterwards keeps the Extension Host clean.
 * The windows themselves are reused instead of being created and closed per
 * conversion: a bounded pool keeps the bundle's captured globals stable and
 * avoids jsdom teardown/creation churn. A window whose conversion failed is
 * discarded and rebuilt on the next acquire.
 */
export class ExcalidrawDomPool {
  private readonly instances: (ExcalidrawDomInstance | undefined)[] = [];
  private cursor = 0;

  constructor(private readonly size: number) {
    if (size < 1) {
      throw new Error('Excalidraw DOM pool size must be at least 1.');
    }
  }

  /** Returns the next window in round-robin order, creating or rebuilding it on demand. */
  acquire(): ExcalidrawDomInstance {
    this.cursor = (this.cursor + 1) % this.size;
    const current = this.instances[this.cursor];
    if (current?.healthy === true) {
      return current;
    }
    if (current !== undefined) {
      current.dom.window.close();
    }
    const created = createDomInstance();
    this.instances[this.cursor] = created;
    return created;
  }

  /** Marks a window as failed so the next acquire rebuilds it. */
  markFailed(instance: ExcalidrawDomInstance): void {
    instance.healthy = false;
  }

  /** Resets an idle window so the next conversion starts from a clean document. */
  release(instance: ExcalidrawDomInstance): void {
    const { document } = instance.dom.window;
    document.head.replaceChildren();
    document.body.replaceChildren();
  }

  /** Closes every pooled window. Call once when the extension is deactivated. */
  dispose(): void {
    for (const instance of this.instances) {
      instance?.dom.window.close();
    }
    this.instances.length = 0;
  }
}

function createDomInstance(): ExcalidrawDomInstance {
  const dom = new JSDOM(domHtml, { url: domUrl });
  installCanvasContextStub(dom);
  return { dom, healthy: true };
}

/** jsdom does not implement canvas 2D contexts; exportToSvg only needs text metrics. */
function installCanvasContextStub(dom: JSDOM): void {
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: (): Record<string, unknown> => createCanvas2DContext(),
  });
}

function noop(): void {
  // The canvas 2D context stub ignores drawing calls; it only needs measureText.
  return;
}

function createCanvas2DContext(): Record<string, unknown> {
  const context: Record<string, unknown> = { filter: 'none', font: '10px sans-serif' };
  for (const property of [
    'fillStyle',
    'strokeStyle',
    'textAlign',
    'textBaseline',
    'globalAlpha',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'miterLimit',
    'shadowBlur',
    'shadowColor',
    'shadowOffsetX',
    'shadowOffsetY',
    'letterSpacing',
    'fontKerning',
  ]) {
    Object.defineProperty(context, property, { get: () => '', set: noop, configurable: true });
  }
  context.measureText = (
    text: unknown,
  ): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } => {
    const textValue = typeof text === 'string' ? text : '';
    const fontValue = typeof context.font === 'string' ? context.font : '10px';
    const fontSize = Number.parseFloat(fontValue) || 10;
    return {
      width: textValue.length * fontSize * 0.6,
      actualBoundingBoxAscent: fontSize * 0.8,
      actualBoundingBoxDescent: fontSize * 0.2,
    };
  };
  for (const method of [
    'save',
    'restore',
    'scale',
    'rotate',
    'translate',
    'transform',
    'setTransform',
    'resetTransform',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'bezierCurveTo',
    'quadraticCurveTo',
    'arc',
    'arcTo',
    'rect',
    'fillRect',
    'strokeRect',
    'clearRect',
    'fillText',
    'strokeText',
    'fill',
    'stroke',
    'clip',
    'drawImage',
    'createImageData',
    'getImageData',
    'putImageData',
    'createLinearGradient',
    'createRadialGradient',
    'createPattern',
    'ellipse',
    'roundRect',
    'setLineDash',
    'getLineDash',
    'reset',
  ]) {
    context[method] = noop;
  }
  return context;
}
