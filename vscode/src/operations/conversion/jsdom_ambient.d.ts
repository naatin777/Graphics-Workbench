/* oxlint-disable typescript/no-restricted-types -- jsdomのuntyped APIを宣言するambient module境界。 */
/**
 * Minimal ambient types for the jsdom surface used by the Excalidraw converter.
 *
 * `@types/jsdom` references `lib.dom`, which would leak browser globals into the
 * whole compilation (including Playwright specs). Declare only what we consume.
 */
declare module 'jsdom' {
  export interface JSDOMWindow {
    close: () => void;
    document: {
      head: { replaceChildren: () => void };
      body: { replaceChildren: () => void };
    };
    navigator: unknown;
    devicePixelRatio: number;
    HTMLCanvasElement: {
      prototype: object;
    };
    XMLSerializer: new () => {
      serializeToString: (node: unknown) => string;
    };
    [key: string]: unknown;
  }

  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: JSDOMWindow;
  }
}
