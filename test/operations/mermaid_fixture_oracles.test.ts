import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { sourceFormatForPath } from '../../src/application/policy/source_format.js';
import { convertToPdfFiles } from '../../src/operations/conversion/convert_to_pdf.js';
import { executePngConversion } from '../../src/operations/conversion/convert_to_png.js';
import { convertToSvgFiles } from '../../src/operations/conversion/convert_to_svg.js';
import { listInputFixturePathsSync, testInputDirectory, testOutputDirectory } from '../helpers/fixture_paths.js';
import { assertPdfMatches, assertRasterMatches } from '../helpers/content_assertions.js';
import { copyInputToWorkspace, withTestWorkspace } from '../helpers/test_workspace.js';

const execFileAsync = promisify(execFile);

suite('Mermaid fixtureの内容比較', () => {
  for (const [index, fixturePath] of listInputFixturePathsSync(path.join(testInputDirectory, 'valid', 'mermaid'))
    .filter((candidatePath) => sourceFormatForPath(candidatePath) === 'mermaid')
    .entries()) {
    test(`mermaid/${path.basename(fixturePath)}をPNG/SVG/PDFへ変換すると固定正解データと一致する`, async () => {
      await withTestWorkspace(async (workspacePath) => {
        const sourcePath = await copyInputToWorkspace(fixturePath, workspaceSourcePath(fixturePath, index));
        const outputDirectory = path.join(workspacePath, 'converted Mermaid', String(index));
        const renderedDirectory = path.join(outputDirectory, 'rendered');
        const actualPngPath = path.join(outputDirectory, 'actual.png');
        const actualSvgPath = path.join(outputDirectory, 'actual.svg');
        const actualPdfPath = path.join(outputDirectory, 'actual.pdf');
        const expectedDirectory = path.join(testOutputDirectory, 'mermaid', sourceName(fixturePath));
        const mermaidTools = { browserChannel: 'chrome', theme: 'default', backgroundColor: 'white' } as const;

        await mkdir(renderedDirectory, { recursive: true });
        await executePngConversion({
          jobs: [{ sourcePath, outputPath: actualPngPath, workspacePath }],
          pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
          ghostscriptTools: { ghostscriptPath: 'gs' },
          mermaidTools,
          drawioTools: { drawioPath: 'drawio' },
          runtime: { resolveConflicts: async () => 'overwrite' },
          runId: `mermaid-${index}-png`,
        });
        await convertToSvgFiles({
          jobs: [{ sourcePath, outputPath: actualSvgPath, workspacePath }],
          pdftocairoTools: { pdftocairoPath: 'pdftocairo' },
          ghostscriptTools: { ghostscriptPath: 'gs' },
          mermaidTools,
          drawioTools: { drawioPath: 'drawio' },
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

        await assertRasterMatches(actualPngPath, path.join(expectedDirectory, 'expected.png'), fixturePath);

        await renderSvg(actualSvgPath, path.join(renderedDirectory, 'actual-svg.png'));
        await renderSvg(path.join(expectedDirectory, 'expected.svg'), path.join(renderedDirectory, 'expected-svg.png'));
        await assertRasterMatches(
          path.join(renderedDirectory, 'actual-svg.png'),
          path.join(renderedDirectory, 'expected-svg.png'),
          `${fixturePath} SVG`,
        );

        await assertPdfMatches(
          actualPdfPath,
          path.join(expectedDirectory, 'expected.pdf'),
          renderedDirectory,
          fixturePath,
        );
      });
    });
  }
});

async function renderSvg(sourcePath: string, outputPath: string): Promise<void> {
  await execFileAsync('rsvg-convert', ['-o', outputPath, sourcePath]);
}

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
