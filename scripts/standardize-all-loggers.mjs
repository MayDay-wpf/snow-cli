import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules' && ent.name !== 'bundle' && ent.name !== '.git') {
        walk(full, out);
      }
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

function deriveNamespace(filePath) {
  // e.g. source/agents/compactAgent.ts -> agents:compactAgent
  // source/utils/connection/ConnectionManager.ts -> connection:ConnectionManager
  const rel = filePath.replace(/\\/g, '/').replace(/^source\//, '').replace(/\.(ts|tsx)$/, '');
  const parts = rel.split('/');
  if (parts[0] === 'utils' && parts.length >= 3) {
    return `${parts[1]}:${parts.slice(2).join('.')}`;
  }
  if (parts.length >= 2) {
    return `${parts[0]}:${parts.slice(1).join('.')}`;
  }
  return `core:${parts[0]}`;
}

const files = walk('source');
let modifiedCount = 0;

for (const f of files) {
  const norm = f.replace(/\\/g, '/');
  if (norm.includes('/test/') || norm.includes('.test.')) continue;
  if (norm.endsWith('source/utils/core/logger.ts') || norm.endsWith('source/cli.tsx')) continue;

  let content = fs.readFileSync(f, 'utf8');
  if (!/\blogger\.(debug|info|warn|error)\(/.test(content)) {
    continue;
  }

  const namespace = deriveNamespace(norm);

  // If file doesn't have `const log = logger.child(...)`, inject it after logger import
  if (!content.includes("const log =") && !content.includes("let log =")) {
    if (content.includes("import {logger}")) {
      content = content.replace(
        /(import\s*\{[^}]*logger[^}]*\}\s*from\s*['"][^'"]+['"];?)/,
        `$1\n\nconst log = logger.child('${namespace}');`
      );
    } else if (content.includes("import {") && content.includes("logger")) {
      content = content.replace(
        /(import\s*\{[\s\S]*?logger[\s\S]*?\}\s*from\s*['"][^'"]+['"];?)/,
        `$1\n\nconst log = logger.child('${namespace}');`
      );
    }
  }

  // Replace logger.debug/info/warn/error with log.debug/info/warn/error safely
  const before = content;
  content = content.replace(/\blogger\.(debug|info|warn|error)\(/g, (_, m) => `log.${m}(`);

  if (content !== before) {
    fs.writeFileSync(f, content, 'utf8');
    modifiedCount++;
    console.log(`Standardized: ${norm} -> ${namespace}`);
  }
}

console.log(`Finished! Total files standardized: ${modifiedCount}`);
