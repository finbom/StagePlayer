// Starts the app with Electron. ELECTRON_RUN_AS_NODE is removed because some
// environments (e.g. tools running inside VS Code) set it, which would make
// Electron behave like plain Node.js.
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
