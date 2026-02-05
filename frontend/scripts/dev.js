#!/usr/bin/env node
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

console.log('Starting dev server...');

// Forward CLI args to vite (e.g. --host --port 3020)
const args = process.argv.slice(2);

// Spawn vite with forwarded args
const vite = spawn('vite', args, {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot
});

vite.on('close', (code) => {
  process.exit(code);
});