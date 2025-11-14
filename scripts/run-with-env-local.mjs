// Generic runner: loads .env.local and spawns the given command with args
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';

dotenv.config({ path: '.env.local' });

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: node scripts/run-with-env-local.mjs <cmd> [...args]');
  process.exit(1);
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));

