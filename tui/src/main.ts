import { runTerminalUi } from './app.js';
import { createOpenTuiScreen } from './screen.js';

const sourceArgument = Bun.argv[2];

if (sourceArgument === undefined || sourceArgument === '') {
  process.stderr.write('Usage: bun run tui <source.pdf>\n');
  process.exitCode = 2;
} else {
  const screen = await createOpenTuiScreen();
  try {
    await runTerminalUi(sourceArgument, screen);
  } finally {
    screen.destroy();
  }
}
