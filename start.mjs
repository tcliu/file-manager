#!/usr/bin/env node
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_MARKER = resolve(__dirname, '.svelte-kit', 'output', 'server', 'index.js');

const args = process.argv.slice(2);
const DEFAULT_PORT = 3000;
let requestedPort = DEFAULT_PORT;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
    requestedPort = Number(args[i + 1]);
    if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      console.error(`Invalid port: ${args[i + 1]}`);
      process.exit(1);
    }
    i++;
  }
}

function findAvailablePort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const probe = createServer();
      probe.once('error', (error) => {
        probe.close();
        if (error.code === 'EADDRINUSE') {
          tryPort(port + 1);
        } else {
          reject(error);
        }
      });
      probe.once('listening', () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, '127.0.0.1');
    }
    tryPort(startPort);
  });
}

async function main() {
  if (!existsSync(BUILD_MARKER)) {
    console.log('Building project for production...');
    await new Promise((resolve, reject) => {
      const build = spawn('npm', ['run', 'build'], {
        cwd: __dirname,
        stdio: 'inherit',
        shell: true,
      });
      build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Build failed (exit code ${code})`))));
    });
  }

  const port = await findAvailablePort(requestedPort);
  console.log(`SvelteKit File Manager running at http://localhost:${port}`);

  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--host', '0.0.0.0'], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  const onShutdown = () => { preview.kill(); process.exit(0); };
  process.on('SIGINT', onShutdown);
  process.on('SIGTERM', onShutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
