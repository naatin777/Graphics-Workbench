import path from 'node:path';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertPdfMatches, assertRasterMatches, assertSvgStructureMatches } from '../helpers/content_assertions.js';
import { readConfiguredConversionTools } from '../helpers/external_tool_settings.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

suite('Mermaid fixtureの内容比較', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'mermaid'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'mermaid')
    .entries()) {
    test(`mermaid/${path.basename(fixturePath)}をPNG/SVG/PDFへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const { pdftocairoTools, mermaidTools, drawioTools } = readConfiguredConversionTools();
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const outputDirectory = path.join(workspacePath, 'converted Mermaid', String(index));
        const actualPngPath = path.join(outputDirectory, 'actual.png');
        const actualSvgPath = path.join(outputDirectory, 'actual.svg');
        const actualPdfPath = path.join(outputDirectory, 'actual.pdf');
        const expectedDirectory = path.join(testOutputDirectory, 'mermaid', sourceName(fixturePath));
        await executePngConversion({
          jobs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          pdftocairoTools,
          mermaidTools,
          drawioTools,
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `mermaid-${index}-png`,
        });
        await convertToSvgFiles({
          jobs: [{ sourcePath, outputPath: actualSvgPath, workspacePath }],
          pdftocairoTools,
          mermaidTools,
          drawioTools,
          runId: `mermaid-${index}-svg`,
        });
        await convertToPdfFiles({
          jobs: [{ sourcePath, outputPath: actualPdfPath, workspacePath }],
          supportedExtensions: ['.mmd', '.mermaid'],
          tools: { mermaidTools },
          runtime: { resolveConflicts: async () => 'overwrite' },
          operationName: `mermaid-${index}-to-pdf`,
          runId: `mermaid-${index}-pdf`,
        });

        const rendererComparison = { rendererVariance: true } as const;
        await assertRasterMatches(
          actualPngPath,
          path.join(expectedDirectory, 'expected.png'),
          fixturePath,
          rendererComparison,
        );

        await assertSvgStructureMatches(
          actualSvgPath,
          path.join(expectedDirectory, 'expected.svg'),
          `${fixturePath} SVG`,
        );

        await assertPdfMatches(
          actualPdfPath,
          path.join(expectedDirectory, 'expected.pdf'),
          path.join(outputDirectory, 'rendered'),
          fixturePath,
          rendererComparison,
        );
      });
    });
  }
});

function workspaceSourcePath(fixturePath: string, index: number): string {
  const extension = path.extname(fixturePath);
  return index === 0
    ? `mermaid root ${index}${extension}`
    : index === 1
      ? `diagrams with spaces/flow ${index}${extension}`
      : `diagrammes/مرحلة/sequence.final.${index}${extension}`;
}

function sourceName(fixturePath: string): string {
  return path.basename(fixturePath, path.extname(fixturePath));
}
