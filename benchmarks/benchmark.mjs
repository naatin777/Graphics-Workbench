/* oxlint-disable typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/only-throw-error -- the standalone harness intentionally uses dynamically loaded benchmark modules. */
// oxlint-disable-next-line project/no-direct-child-process -- cold mode intentionally uses a fresh Node child to measure startup and module-load cost.
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchmarkDirectory, '..');
const defaultIterations = 10;
const defaultWarmupIterations = 3;
const maxInputPixels = 50_000_000;

const pdfFixtures = [
  {
    size: 'small',
    relativePath: 'test/input/valid/pdf/single-page-document.pdf',
    description: '1 page / 6.8 KiB fixture',
  },
  {
    size: 'medium',
    relativePath: 'test/input/valid/pdf/multi-page-table.pdf',
    description: '2 page / 43 KiB fixture',
  },
  {
    size: 'large',
    relativePath: 'test/input/valid/pdf/multi-page-mixed-content.pdf',
    description: '15 page / 656 KiB fixture',
  },
];

const sharpFixtures = [
  {
    size: 'small',
    relativePath: 'test/input/valid/png/grayscale-gradient.png',
    description: '384 × 288 PNG / 0.11 MP',
  },
  {
    size: 'medium',
    relativePath: 'test/input/valid/png/checker-mosaic.png',
    description: '640 × 480 PNG / 0.31 MP',
  },
  {
    size: 'large',
    relativePath: 'test/input/valid/jpeg/flower-field.jpg',
    description: '2518 × 1968 JPEG / 4.96 MP',
  },
];

const pixelFixtures = [
  { size: 'small', width: 384, height: 288, description: '384 × 288 RGB / 0.11 MP' },
  { size: 'medium', width: 1280, height: 960, description: '1280 × 960 RGB / 1.23 MP' },
  { size: 'large', width: 2560, height: 1920, description: '2560 × 1920 RGB / 4.92 MP' },
];

const args = parseArguments(process.argv.slice(2));

if (args.coldChild === undefined) {
  await runMain(args);
} else {
  await runColdChild(args.coldChild);
}

function parseArguments(argv) {
  const result = {
    mode: 'both',
    filter: undefined,
    format: 'markdown',
    outputPath: undefined,
    iterations: defaultIterations,
    warmupIterations: defaultWarmupIterations,
    coldChild: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      result.mode = argv[++index];
    } else if (argument === '--filter') {
      result.filter = argv[++index];
    } else if (argument === '--format') {
      result.format = argv[++index];
    } else if (argument === '--out') {
      result.outputPath = argv[++index];
    } else if (argument === '--iterations') {
      result.iterations = parsePositiveInteger(argv[++index], '--iterations');
    } else if (argument === '--warmup-iterations') {
      result.warmupIterations = parsePositiveInteger(argv[++index], '--warmup-iterations');
    } else if (argument === '--cold-child') {
      result.coldChild = argv[++index];
    } else if (argument === '--help') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!['cold', 'warm', 'both'].includes(result.mode)) {
    throw new Error(`--mode must be cold, warm, or both: ${result.mode}`);
  }
  if (!['json', 'markdown'].includes(result.format)) {
    throw new Error(`--format must be json or markdown: ${result.format}`);
  }
  return result;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer: ${value}`);
  }
  return parsed;
}

function printUsage() {
  process.stdout.write(`Usage: node benchmarks/benchmark.mjs [options]

Options:
  --mode cold|warm|both       Run fresh-child cold runs, in-process warm runs, or both.
  --filter text               Run scenario IDs containing text.
  --format markdown|json      Output format (default: markdown).
  --out path                  Also write the rendered output to path.
  --iterations N              Warm measured iterations (default: 10).
  --warmup-iterations N       Warmup iterations (default: 3).
`);
}

async function runMain(options) {
  const startedAt = new Date().toISOString();
  const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const tinybench = await loadTinybench();
  const runtime = await loadRuntime();
  const scenarios = await buildScenarios(runtime);
  const selectedScenarios = scenarios.filter((scenario) => options.filter === undefined || scenario.id.includes(options.filter));

  if (selectedScenarios.length === 0) {
    throw new Error(`No benchmark scenarios matched: ${options.filter ?? '(all)'}`);
  }

  const results = [];
  if (options.mode === 'cold' || options.mode === 'both') {
    for (const scenario of selectedScenarios) {
      results.push(await runColdScenario(scenario));
    }
  }
  if (options.mode === 'warm' || options.mode === 'both') {
    for (const scenario of selectedScenarios) {
      results.push(
        await runWarmScenario(scenario, tinybench.Bench, {
          iterations: options.iterations,
          warmupIterations: options.warmupIterations,
        }),
      );
    }
  }

  const report = {
    generatedAt: startedAt,
    gitCommit,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    memory: `${Math.round(os.totalmem() / 1024 / 1024)} MiB total`,
    tinybench: tinybench.version,
    configuration: {
      mode: options.mode,
      filter: options.filter ?? null,
      iterations: options.iterations,
      warmupIterations: options.warmupIterations,
      maxInputPixels,
    },
    results,
  };

  const rendered = options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
  if (options.outputPath !== undefined) {
    const absoluteOutputPath = path.resolve(repositoryRoot, options.outputPath);
    await writeFile(absoluteOutputPath, rendered, 'utf8');
  }
  process.stdout.write(rendered);
}

async function loadTinybench() {
  try {
    const module = await import('tinybench');
    return {
      Bench: module.Bench,
      version: JSON.parse(await readFile(path.join(repositoryRoot, 'node_modules/tinybench/package.json'), 'utf8')).version,
    };
  } catch (error) {
    throw new Error(
      'tinybench is required for this harness. Run npm ci from the repository root; package.json and package-lock.json are intentionally not changed.',
      { cause: error },
    );
  }
}

async function loadRuntime() {
  const [mupdf, rasterInput] = await Promise.all([
    import('../core/dist/operations/pdf/mupdf.js'),
    import('../core/dist/operations/conversion/raster_input.js'),
  ]);
  return { mupdf, rasterInput };
}

async function buildScenarios(runtime, requestedId) {
  const scenarios = [];

  for (const fixture of pixelFixtures) {
    const id = `mupdf-pixel-scan/${fixture.size}`;
    if (!wantsScenario(requestedId, id)) {
      continue;
    }
    const pixels = createWorstCasePixels(fixture.width, fixture.height);
    const pixmap = {
      getWidth: () => fixture.width,
      getHeight: () => fixture.height,
      getPixels: () => pixels,
      asPNG: () => new Uint8Array(),
      destroy: () => undefined,
    };
    scenarios.push({
      id,
      family: 'MuPDF pixel/content scan',
      size: fixture.size,
      input: fixture.description,
      workUnit: `${fixture.width * fixture.height} RGB pixels scanned`,
      run: () => {
        const bounds = runtime.mupdf.findVisiblePixelBounds(pixmap);
        if (bounds === undefined) {
          throw new Error(`Expected visible content in ${fixture.size} pixel fixture.`);
        }
        return bounds;
      },
    });
  }

  for (const fixture of pdfFixtures) {
    const contentScanId = `mupdf-content-scan/${fixture.size}`;
    const rasterId = `mupdf-pdf-raster/${fixture.size}`;
    if (!wantsScenario(requestedId, contentScanId) && !wantsScenario(requestedId, rasterId)) {
      continue;
    }
    const sourcePath = path.join(repositoryRoot, fixture.relativePath);
    const bytes = await readFile(sourcePath);
    const pageCount = await runtime.mupdf.countPdfPages(bytes);
    const pages = Array.from({ length: pageCount }, (_value, index) => index + 1);

    if (wantsScenario(requestedId, contentScanId)) {
      scenarios.push({
        id: contentScanId,
        family: 'MuPDF PDF content scan',
        size: fixture.size,
        input: fixture.description,
        workUnit: `${pageCount} page content probes per operation`,
        run: async () => {
          let visiblePages = 0;
          for (const page of pages) {
            if (await runtime.mupdf.hasPdfPageContent(bytes, page)) {
              visiblePages += 1;
            }
          }
          if (visiblePages === 0) {
            throw new Error(`Expected visible content in ${fixture.relativePath}.`);
          }
          return visiblePages;
        },
      });
    }

    if (wantsScenario(requestedId, rasterId)) {
      scenarios.push({
        id: rasterId,
        family: 'MuPDF PDF raster',
        size: fixture.size,
        input: fixture.description,
        workUnit: `${pageCount} pages rendered to PNG buffers per operation`,
        run: async () => {
          let outputBytes = 0;
          for (const page of pages) {
            outputBytes += (await runtime.mupdf.renderPdfPageToPng(bytes, page)).byteLength;
          }
          if (outputBytes === 0) {
            throw new Error(`Expected PNG output from ${fixture.relativePath}.`);
          }
          return outputBytes;
        },
      });
    }
  }

  for (const fixture of sharpFixtures) {
    const sourcePath = path.join(repositoryRoot, fixture.relativePath);
    const id = `sharp-raster-encode/${fixture.size}`;
    if (wantsScenario(requestedId, id)) {
      scenarios.push({
        id,
        family: 'Sharp path-backed raster decode/encode',
        size: fixture.size,
        input: fixture.description,
        workUnit: 'source decode and PNG encode to an in-memory buffer',
        run: async () => {
          const pipeline = runtime.rasterInput.openRasterInput(sourcePath, maxInputPixels);
          try {
            const output = await pipeline.png().toBuffer();
            if (output.byteLength === 0) {
              throw new Error(`Expected PNG output from ${fixture.relativePath}.`);
            }
            return output.byteLength;
          } finally {
            await runtime.rasterInput.closeRasterPipeline(pipeline);
          }
        },
      });
    }
  }

  return scenarios;
}

function wantsScenario(requestedId, candidateId) {
  return requestedId === undefined || requestedId === candidateId;
}

function createWorstCasePixels(width, height) {
  const pixels = new Uint8ClampedArray(width * height * 3);
  pixels.fill(255);
  const lastPixel = (width * height - 1) * 3;
  pixels[lastPixel] = 0;
  pixels[lastPixel + 1] = 0;
  pixels[lastPixel + 2] = 0;
  return pixels;
}

async function runColdScenario(scenario) {
  const child = spawn(process.execPath, [process.argv[1], '--cold-child', scenario.id], {
    cwd: repositoryRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });
  let stdout = '';
  for await (const chunk of child.stdout) {
    stdout += chunk;
  }
  const exitCode = await new Promise((resolve) => {
    child.once('close', (code) => resolve(code));
  });
  if (exitCode !== 0) {
    throw new Error(`Cold benchmark failed for ${scenario.id} with exit code ${exitCode}.`);
  }
  const childResult = JSON.parse(stdout.trim());
  return {
    ...scenarioMetadata(scenario),
    mode: 'cold',
    samples: 1,
    meanMs: childResult.elapsedMs,
    p50Ms: childResult.elapsedMs,
    p95Ms: childResult.elapsedMs,
    p99Ms: childResult.elapsedMs,
    minMs: childResult.elapsedMs,
    maxMs: childResult.elapsedMs,
    memory: childResult.memory,
    responsiveness: childResult.responsiveness,
    note: 'Fresh Node child; includes module load and fixture read/setup.',
  };
}

async function runColdChild(scenarioId) {
  const started = performance.now();
  const before = process.memoryUsage();
  const probe = startEventLoopProbe();
  let peakRss = before.rss;
  const runtime = await loadRuntime();
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const scenarios = await buildScenarios(runtime, scenarioId);
  const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
  if (scenario === undefined) {
    throw new Error(`Unknown cold benchmark scenario: ${scenarioId}`);
  }

  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  await scenario.run();
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const responsiveness = await probe.stop();
  const after = process.memoryUsage();
  const elapsedMs = performance.now() - started;
  process.stdout.write(
    JSON.stringify({ elapsedMs, memory: memorySummary(before, after, peakRss), responsiveness }),
  );
}

async function runWarmScenario(scenario, Bench, options) {
  const before = process.memoryUsage();
  let peakRss = before.rss;
  const probe = startEventLoopProbe();
  const bench = new Bench({
    time: 0,
    iterations: options.iterations,
    warmupTime: 0,
    warmupIterations: options.warmupIterations,
    throws: true,
  });
  bench.add(scenario.id, async () => {
    await scenario.run();
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  });
  await bench.run();
  const responsiveness = await probe.stop();
  const after = process.memoryUsage();
  const taskResult = bench.tasks[0].result;
  if (taskResult === undefined || taskResult.error !== undefined) {
    throw taskResult?.error ?? new Error(`Warm benchmark failed for ${scenario.id}.`);
  }

  return {
    ...scenarioMetadata(scenario),
    mode: 'warm',
    samples: taskResult.samples.length,
    meanMs: taskResult.mean,
    p50Ms: percentile(taskResult.samples, 50),
    p95Ms: percentile(taskResult.samples, 95),
    p99Ms: percentile(taskResult.samples, 99),
    minMs: taskResult.min,
    maxMs: taskResult.max,
    hz: taskResult.hz,
    memory: memorySummary(before, after, peakRss),
    responsiveness,
    note: 'Same process after fixed warmup; fixture data is reused in memory.',
  };
}

function scenarioMetadata(scenario) {
  return {
    id: scenario.id,
    family: scenario.family,
    size: scenario.size,
    input: scenario.input,
    workUnit: scenario.workUnit,
  };
}

function percentile(samples, percentileValue) {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = (percentileValue / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function memorySummary(before, after, peakRss) {
  return {
    beforeRssMiB: bytesToMiB(before.rss),
    afterRssMiB: bytesToMiB(after.rss),
    peakRssMiB: bytesToMiB(peakRss),
    deltaRssMiB: bytesToMiB(after.rss - before.rss),
    heapUsedDeltaMiB: bytesToMiB(after.heapUsed - before.heapUsed),
    arrayBuffersDeltaMiB: bytesToMiB(after.arrayBuffers - before.arrayBuffers),
  };
}

function bytesToMiB(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function startEventLoopProbe(intervalMs = 10) {
  const monitor = monitorEventLoopDelay({ resolution: intervalMs });
  monitor.enable();
  let lastTick = performance.now();
  const delays = [];
  const timer = setInterval(() => {
    const now = performance.now();
    delays.push(Math.max(0, now - lastTick - intervalMs));
    lastTick = now;
  }, intervalMs);

  return {
    async stop() {
      clearInterval(timer);
      await new Promise((resolve) => {
        setImmediate(() => resolve());
      });
      monitor.disable();
      return {
        intervalMs,
        ticks: delays.length,
        delayedTicksOver20Ms: delays.filter((delay) => delay > 20).length,
        maxTimerDelayMs: delays.length === 0 ? null : Math.max(...delays),
        p95TimerDelayMs: percentile(delays, 95),
        monitorP95DelayMs: Number((monitor.percentile(95) / 1e6).toFixed(2)),
      };
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    '# Benchmark result',
    '',
    `Generated: ${report.generatedAt}`,
    `Commit: \`${report.gitCommit}\``,
    `Environment: ${report.node}, ${report.platform}, ${report.cpu} (${report.cpuCount} logical CPUs), ${report.memory}`,
    `Harness: tinybench ${report.tinybench}; mode=${report.configuration.mode}; measured iterations=${report.configuration.iterations}; warmup iterations=${report.configuration.warmupIterations}`,
    '',
    'Cold runs are one operation in a fresh Node child and include module loading plus fixture setup. Warm runs reuse the loaded modules and fixture data after the fixed warmup. `mean/p50/p95/p99` are milliseconds per operation; PDF rows process every page in the named fixture.',
    '',
    '| Scenario | Mode | Input/work unit | Samples | Mean ms | p50 ms | p95 ms | p99 ms | Peak RSS MiB | RSS Δ MiB | Host proxy p95/max ms |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const result of report.results) {
    const hostProxy = `${formatNumber(result.responsiveness.p95TimerDelayMs)}/${formatNumber(result.responsiveness.maxTimerDelayMs)}`;
    lines.push(
      `| ${result.id} | ${result.mode} | ${result.input}; ${result.workUnit} | ${result.samples} | ${formatNumber(result.meanMs)} | ${formatNumber(result.p50Ms)} | ${formatNumber(result.p95Ms)} | ${formatNumber(result.p99Ms)} | ${formatNumber(result.memory.peakRssMiB)} | ${formatNumber(result.memory.deltaRssMiB)} | ${hostProxy} |`,
    );
  }

  lines.push('', 'Memory details: RSS is the process total (including MuPDF WASM/native allocations); heap and ArrayBuffer deltas are recorded in JSON output. The host proxy uses a 10 ms timer and `monitorEventLoopDelay`; it is not a VS Code Electron measurement.', '');
  return lines.join('\n');
}

function formatNumber(value) {
  return value === null || value === undefined || Number.isNaN(value) ? 'n/a' : Number(value).toFixed(2);
}
