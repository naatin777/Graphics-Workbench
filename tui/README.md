# Graphics Workbench Terminal UI

The Terminal UI is a separate Bun frontend. It reuses the repository's TypeScript operations and therefore needs both dependency sets installed:

```bash
npm ci
bun install --cwd tui --frozen-lockfile
```

Run the Phase 1 PDF raster conversion UI from the repository root:

```bash
bun run tui ./example.pdf
```

Relative source paths are resolved from the directory where the root command is run. Bun 1.3 or newer is required by OpenTUI.

The source file's directory is the operation workspace. Outputs and `.graphics-workbench` staging stay inside that directory. The MVP supports PDF to PNG, JPEG, and WebP, with all-page or range selection. VS Code configuration UI, Undo history, previews, and external-tool conversions remain outside this frontend.

Use `Esc` or `Ctrl+C` to request cancellation. MuPDF and Sharp cancellation is best effort during their synchronous sections; the UI waits for active work, rollback, and cleanup before restoring the terminal.
