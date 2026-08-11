import type { RunRsvgConvert } from '../../external_tools/run_rsvg_convert_with_ascii_scratch.js';

type SvgToPdfEngine = 'chrome' | 'rsvg-convert';
type RunChrome = (executable: string, args: string[], signal: AbortSignal) => Promise<void>;

export interface SvgToPdfBackend {
  engine: SvgToPdfEngine;
  rsvgConvertPath: string;
  chromePath: string;
  runRsvgConvert: RunRsvgConvert;
  runChrome: RunChrome;
}
