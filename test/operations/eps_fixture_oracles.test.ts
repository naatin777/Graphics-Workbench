import path from 'node:path';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertPdfMatches, assertRasterMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

suite('EPS fixtureの内容比較', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'eps'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'eps')
    .entries()) {
    test(`eps/${path.basename(fixturePath)}をPDF/PNGへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const { pdftocairoTools, ghostscriptTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const outputDirectory = path.join(workspacePath, 'converted EPS', String(index));
        const actualPdfPath = path.join(outputDirectory, 'actual.pdf');
        const actualPngPath = path.join(outputDirectory, 'actual.png');
        const expectedDirectory = path.join(testOutputDirectory, 'eps', sourceName(fixturePath));

        await convertToPdfFiles({
          jobs: [{ sourcePath, outputPath: actualPdfPath, workspacePath }],
          tools: { ghostscriptPath: ghostscriptTools.ghostscriptPath },
          supportedExtensions: ['.eps'],
          runtime: { resolveConflicts: async () => 'overwrite' },
          operationName: `eps-${index}-to-pdf`,
          runId: `eps-${index}-pdf`,
        });
        await executePngConversion({
          jobs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          pdftocairoTools,
          ghostscriptTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `eps-${index}-png`,
        });

        await assertPdfMatches(
          actualPdfPath,
          path.join(expectedDirectory, 'expected.pdf'),
          path.join(outputDirectory, 'pdf-rendered'),
          fixturePath,
        );
        await assertRasterMatches(actualPngPath, path.join(expectedDirectory, 'expected.png'), fixturePath);
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index === 0 ? `eps root ${index}${extension}` : `plots/результаты/sine.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
