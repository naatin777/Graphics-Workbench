import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { excalidrawToSvg } from '../../src/operations/conversion/excalidraw_adapter.js';
import { executeRasterConversion, rasterFormatSpecs } from '../../src/operations/conversion/raster_conversion.js';
import { assertRasterMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

const projectRootDirectory = path.dirname(path.dirname(testInputDirectory));
const excalidrawBundlePath = path.join(projectRootDirectory, 'media', 'excalidraw', 'excalidraw-adapter.mjs');

suite('Excalidrawテスト入力のSVG変換とPNG変換結果が、期待出力PNGと一致することを比較', () => {
  // embedded-image.excalidrawは除外する。librsvg（rsvg-convert / sharp）が半透明PNGの
  // <image>埋め込みSVGを崩して描画するため、baselineに崩れを焼き込むことになる。
  // 詳細: docs/research/2026-08-08-librsvg-semi-transparent-png-image.md
  const fixturePaths = listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'excalidraw')).filter(
    (fixturePath) => !path.basename(fixturePath).startsWith('embedded-image'),
  );

  for (const [index, fixturePath] of fixturePaths.entries()) {
    test(`excalidraw/${path.basename(fixturePath)}をexcalidrawToSvgでSVGへ変換し、そのSVGをPNG変換した結果が許容差付きで期待出力PNGと一致する`, async function fixtureOracle() {
      if (!existsSync(excalidrawBundlePath)) {
        this.skip();
        return;
      }

      await withTestWorkspace(async (workspacePath) => {
        const { pdfRenderTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const svgPath = path.join(workspacePath, 'converted', `excalidraw-${index}.svg`);
        const outputPath = path.join(workspacePath, 'converted', `excalidraw-${index}.png`);
        const expectedPath = path.join(testOutputDirectory, 'excalidraw', sourceName(fixturePath), 'expected.png');

        await mkdir(path.dirname(svgPath), { recursive: true });
        await excalidrawToSvg({
          sourcePath,
          svgPath,
          bundleUrl: pathToFileURL(excalidrawBundlePath).href,
        });
        await executeRasterConversion({
          spec: rasterFormatSpecs.png,
          maxInputPixels: 1_000_000_000,
          inputs: [{ sourcePath: svgPath, outputPath, workspacePath }],
          pdfRenderTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `excalidraw-${index}`,
        });

        await assertRasterMatches(outputPath, expectedPath, fixturePath, { rendererVariance: true });
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index % 2 === 0 ? `excalidraw root ${index}${extension}` : `figures/シーン 🎨/diagram.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
