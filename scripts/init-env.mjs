// Creates backend/.env and admin/.env.local from the examples, with fresh secrets. Never overwrites.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const backendEnv = 'backend/.env';
if (!existsSync(backendEnv)) {
  const text = readFileSync('backend/.env.example', 'utf8')
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString('hex')}`)
    .replace(/^AGENT_MASTER_KEY=.*$/m, `AGENT_MASTER_KEY=${randomBytes(24).toString('base64url')}`);
  writeFileSync(backendEnv, text);
  console.log('Created backend/.env with fresh secrets');
} else console.log('backend/.env already exists — left unchanged');

if (!existsSync('admin/.env.local')) {
  copyFileSync('admin/.env.example', 'admin/.env.local');
  console.log('Created admin/.env.local');
} else console.log('admin/.env.local already exists — left unchanged');
