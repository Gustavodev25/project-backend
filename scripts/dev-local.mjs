// Ensure local dev always runs with .env.local
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';

// Load .env.local (silent if missing)
dotenv.config({ path: '.env.local' });

// Forward any args passed to this script to `next dev`
const extraArgs = process.argv.slice(2);

const child = spawn(
  // Use shell so Windows can resolve node_modules/.bin/next.cmd
  'next',
  ['dev', '--turbopack', ...extraArgs],
  { stdio: 'inherit', shell: true, env: process.env }
);

child.on('exit', (code) => process.exit(code ?? 0));

