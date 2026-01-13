#!/usr/bin/env node
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

console.log('Starting dev server...');

// Spawn vite with default config
const vite = spawn('vite', [], {
  stdio: 'inherit',
  shell: true,
  cwd: projectRoot
});

vite.on('close', (code) => {
  process.exit(code);
});