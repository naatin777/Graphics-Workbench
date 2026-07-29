import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { OutputInfo } from 'sharp';

import { assertExistingPathInWorkspace, assertWritablePathInWorkspace } from '../../security/workspace_path.js';
import type { CommittedConversionOutput, PreparedConversionOutput } from '../lifecycle/commit_conversion_outputs.js';
import type { ConversionExecutionContext } from '../lifecycle/conversion_runtime.js';
import { runStagedConversionBatch } from '../lifecycle/run_staged_conversion_batch.js';
import { assertPreflightPassed, preflightOptionsFromRuntime } from '../input/input_preflight.js';
import { isSameSourceFormat } from '../../application/policy/source_format.js';
import { DEFAULT_MAX_INPUT_PIXELS } from '../../config/raster_input.js';
import {
  destroyRasterInput,
  openRasterInput,
  readRawSidecar as readRawSidecarValue,
  type RawSidecar,
} from './raster_input.js';

export interface ConvertToRawJob {
  sourcePath: string;
  outputPath: string;
  workspacePath: string;
  page?: number;
}

export interface ConvertToRawFilesOptions {
  jobs: ConvertToRawJob[];
  runtime: ConversionExecutionContext;
  runId?: string;
  maxInputPixels?: number;
}

export async function convertToRawFiles(options: ConvertToRawFilesOptions): Promise<CommittedConversionOutput[]> {
  if (options.jobs.length === 0) {
    throw new Error('No files were selected.');
  }

  for (const job of options.jobs) {
    if (isSameSourceFormat(job.sourcePath, '.raw')) {
      throw new Error(`Input and output formats must differ: ${job.sourcePath}`);
    }
  }

  await Promise.all(
    options.jobs.flatMap((job) => [
      assertExistingPathInWorkspace(job.sourcePath, job.workspacePath),
      assertWritablePathInWorkspace(job.outputPath, job.workspacePath),
      assertWritablePathInWorkspace(`${job.outputPath}.json`, job.workspacePath),
    ]),
  );
  const sidecars = await Promise.all(
    options.jobs.map(async (job) => readRawSidecar(job.sourcePath, job.workspacePath)),
  );
  options.runtime.signal?.throwIfAborted();
  await assertPreflightPassed(options.jobs, preflightOptionsFromRuntime(options.runtime));

  return runStagedConversionBatch({
    jobs: options.jobs,
    operationName: 'convert-to-raw',
    runId: options.runId ?? `${Date.now()}-${crypto.randomUUID()}`,
    runtime: options.runtime,
    stage: async (job, index, runId, runtime) => {
      runtime.signal?.throwIfAborted();
      const sidecar = sidecars[index];
      const stagingRootPath = path.join(job.workspacePath, '.graphics-workbench', 'convert-to-raw', runId);
      const stageDirectory = path.join(stagingRootPath, String(index + 1));
      const stagedOutputPath = path.join(stageDirectory, 'result.raw');
      const stagedSidecarPath = `${stagedOutputPath}.json`;

      await assertWritablePathInWorkspace(stagedOutputPath, job.workspacePath);
      await assertWritablePathInWorkspace(stagedSidecarPath, job.workspacePath);
      await mkdir(stageDirectory, { recursive: true });
      runtime.signal?.throwIfAborted();

      const image = openRasterInput(job.sourcePath, options.maxInputPixels ?? DEFAULT_MAX_INPUT_PIXELS, job.page);
      let data: Buffer;
      let info: OutputInfo;
      let colourspace: RawSidecar['colourspace'];
      try {
        const metadata = await image.metadata();
        ({ data, info } = await image.raw({ depth: sidecar?.depth ?? 'uchar' }).toBuffer({ resolveWithObject: true }));
        colourspace = metadata.space;
      } finally {
        await destroyRasterInput(image);
      }
      const outputSidecar: RawSidecar = {
        version: 1,
        width: info.width,
        height: info.height,
        channels: toRawChannels(info.channels),
        depth: sidecar?.depth ?? 'uchar',
        colourspace,
        alpha: info.hasAlpha,
        layout: 'interleaved',
      };
      await writeFile(stagedOutputPath, data);
      runtime.signal?.throwIfAborted();
      await writeFile(stagedSidecarPath, `${JSON.stringify(outputSidecar, null, 2)}\n`);

      const outputs: PreparedConversionOutput[] = [
        {
          stagedOutputPath,
          outputPath: job.outputPath,
          workspacePath: job.workspacePath,
          stagingRootPath,
          keepBothGroup: { basePath: job.outputPath, suffix: '' },
        },
        {
          stagedOutputPath: stagedSidecarPath,
          outputPath: `${job.outputPath}.json`,
          workspacePath: job.workspacePath,
          stagingRootPath,
          keepBothGroup: { basePath: job.outputPath, suffix: '.json' },
        },
      ];
      return outputs;
    },
  });
}

async function readRawSidecar(sourcePath: string, workspacePath: string): Promise<RawSidecar | undefined> {
  if (!sourcePath.toLowerCase().endsWith('.raw')) {
    return undefined;
  }

  const sidecarPath = `${sourcePath}.json`;
  await assertExistingPathInWorkspace(sourcePath, workspacePath);
  await assertExistingPathInWorkspace(sidecarPath, workspacePath);

  return readRawSidecarValue(sourcePath);
}

function toRawChannels(value: number): RawSidecar['channels'] {
  if (value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  throw new Error(`Unsupported raw channel count: ${value}`);
}
