---
name: graphics-workbench-fixture-oracles
description: Maintain Graphics Workbench conversion tests with fixed files from test/input, reviewed expected artifacts in test/output, and pixel-level content oracles. Use when adding or changing raster, PDF, SVG, Mermaid, Draw.io, Excalidraw, or EPS conversion tests, replacing generated test fixtures, adding expected outputs, or strengthening conversion tests beyond metadata/readability checks.
---

# Graphics Workbench Fixture Oracles

Use this skill for conversion tests whose normal path should exercise a real file and verify its rendered content. Keep fixture policy, comparison strength, and test execution aligned with the repository rules.

## Start safely

1. Read the repository `AGENTS.md` and the relevant sections of `docs/specs/internal/test-policy.md`.
2. Inspect `git status --short --branch`, existing worktrees, and the nearest tests before editing.
3. Create a dedicated worktree from local `main` with a task-specific branch and path. Do not edit the user's current worktree unless explicitly instructed.
4. Read `.agents/skills/graphics-workbench-verify/SKILL.md` before choosing test commands.
5. Limit the change to one conversion-test objective. Preserve unrelated tests, fixtures, and behavior.

## Choose fixtures

- Enumerate candidates in `test/input/valid/<format>/` and expected artifacts in `test/output/<format>/<case>/` before writing a test.
- For normal successful conversions, copy a fixed input from `test/input` into the isolated test workspace. Use existing helpers such as `copyInputToWorkspace` and `withTestWorkspace` when the operation requires workspace paths.
- Keep expected artifacts under `test/output`. Never create or overwrite an expected artifact while the test is running.
- Reuse the repository's fixture naming convention: the source case directory is derived from the input basename, and expected files use explicit names such as `expected.png`, `expected.pdf`, `expected.svg`, or `page-001.png`.
- If a required input or expected artifact does not exist, record the missing characteristics and ask for a fixture, or leave the case as an explicit gap. Do not invent a new normal-path fixture inside the test.
- Keep generated data only for a distinct purpose such as malformed input, a precise boundary value, cancellation/error injection, or a backend mock contract. Document that purpose and do not duplicate a fixed-fixture normal-path test.

## Add expected artifacts

- Update `scripts/generate-test-output.ts` when an expected artifact must be reproducibly regenerated from a committed input and the repository's configured renderer.
- Review generated binary diffs deliberately. Confirm dimensions, page selection, transparency, fonts/text, orientation, and asymmetric markers before accepting a baseline.
- Keep source inputs and expected outputs in separate immutable directories. Tests may write only to their temporary workspace or staging area.
- Do not use a test's output as its own oracle, and do not silently regenerate baselines to make a failing test pass.

## Implement pixel oracles

- Decode raster outputs to RGBA and compare them with `assertRasterMatches` from `vscode/test/support/helpers/content_assertions.ts`. Keep width and height checks enabled.
- For PDF results, compare page count and page geometry, render corresponding pages with the repository PDF renderer, and compare the rendered pixels to the matching `test/output` page image or expected PDF.
- For SVG, compare rendered pixels when visual content is the contract; use structural checks as a supplementary check for stable SVG semantics. Do not use raw byte equality for renderer-produced SVG.
- For Mermaid, Draw.io, Excalidraw, and EPS, use the fixed input and the appropriate configured backend, then compare the resulting raster or rendered PDF to its fixed expected artifact.
- For JPEG, WebP, AVIF, GIF, or other lossy/renderer-variable output, set the narrowest measured tolerance supported by the existing comparison helper. Keep the comparison sensitive to one-pixel shifts and record why variance is needed.
- Cover every required source/target combination with a fixture-driven table or loop. Do not reduce a content assertion to “file exists”, decoder format, dimensions, or page count when rendered content is the purpose.
- Keep command-layer tests focused on command routing, configuration, output paths, notifications, Safe Mode, Undo, and cancellation. Put broad format/content matrices at the operation or fixture-oracle layer, then avoid maintaining duplicate tests for the same purpose.

## Preserve boundaries

- Retain invalid-input, same-format, pixel-limit, cancellation, Safe Mode, rollback, cleanup, and Undo tests even when normal-path fixtures are migrated.
- Keep mocked external-tool tests when they prove argument construction or error mapping. Use a committed input fixture for the source when that path is part of the contract; use a small generated payload only for the injected tool response when necessary.
- Do not bypass staging, workspace path validation, Safe Mode, rollback, cleanup, or cancellation checks to make a fixture test simpler.

## Verify

Run the smallest complete set that covers the changed subsystem, then report every command and result:

- Host checks and builds: `npm run check`, `npm run build`, and any relevant `npm run test:webview:<app>` or `npm run test:scripts`.
- Extension Host tests that open a window: `npm run test:docker` or `npm run test:core -- --grep <pattern>` for a core-owned subset.
- Packaged Playwright smoke: `npm run playwright:smoke:docker` when packaging or packaged conversion behavior changed.
- Fixture-oracle tests must run with the configured external tools required by their format. Report skipped cases and missing tools explicitly.

Before handoff, check `git diff --check`, confirm no generated workspace artifacts are tracked, inspect `git diff --stat` and `git diff --name-only`, and state the dedicated worktree path. Do not claim pixel coverage for cases that were not executed.
