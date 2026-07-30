import path from 'node:path';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertRasterMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

suite('SVG fixtureの内容比較', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'svg'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'svg')
    .entries()) {
    test(`svg/${path.basename(fixturePath)}をPNGへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const { pdftocairoTools, ghostscriptTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const outputPath = path.join(workspacePath, 'converted', `svg-${index}.png`);
        const expectedPath = path.join(testOutputDirectory, 'svg', sourceName(fixturePath), 'expected.png');

        await executePngConversion({
          jobs: [{ sourcePath, outputPath, workspacePath }],
          pdftocairoTools,
          ghostscriptTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `svg-${index}`,
        });

        await assertRasterMatches(outputPath, expectedPath, fixturePath);
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index % 2 === 0 ? `svg root ${index}${extension}` : `illustrations/éléments 🚀/gradient.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
