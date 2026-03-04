/**
 * Copies built agent (dist, dashboard/dist, registry, context, config) into desktop/agent-app
 * so electron-builder can package them as extraResources.
 * Run from repo root: node desktop/copy-agent-app.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(__dirname, 'agent-app');

const dirs = [
  { from: 'dist', to: 'dist' },
  { from: 'dashboard/dist', to: 'dashboard/dist' },
  { from: 'registry', to: 'registry' },
  { from: 'context', to: 'context' },
  { from: 'config', to: 'config' },
];

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn('Skip (missing):', src);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(out)) fs.rmSync(out, { recursive: true });
fs.mkdirSync(out, { recursive: true });

for (const { from, to } of dirs) {
  const src = path.join(root, from);
  const dest = path.join(out, to);
  console.log('Copy', from, '->', to);
  copyRecursive(src, dest);
}

console.log('agent-app ready at', out);
