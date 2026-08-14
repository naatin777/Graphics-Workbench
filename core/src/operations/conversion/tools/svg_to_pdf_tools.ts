import type { Result } from 'better-result';

import type { RunRsvgConvert } from '../../external_tools/run_rsvg_convert_with_ascii_scratch.js';
import type { ExternalToolError } from '../../external_tools/run_external_tool.js';

type SvgToPdfEngine = 'chrome' | 'rsvg-convert';
type RunChrome = (executable: string, args: string[], signal: AbortSignal) => Promise<Result<void, ExternalToolError>>;

export interface SvgToPdfBackend {
  engine: SvgToPdfEngine;
  rsvgConvertPath: string;
  chromePath: string;
  runRsvgConvert: RunRsvgConvert;
  runChrome: RunChrome;
}
