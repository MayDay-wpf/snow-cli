import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name !== 'node_modules' && ent.name !== 'vendor' && ent.name !== '.git') {
        walk(full, out);
      }
    } else if (/\.(ts|tsx)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(path.resolve('source')).filter(f => !f.includes(path.sep + 'test' + path.sep));

let totalConsole = 0;
const consoleByFile = {};
const ALLOWED_STANDALONE = new Set([
  path.normalize('source/cli.tsx'),
  path.normalize('source/ui/pages/HeadlessModeScreen.tsx'),
  path.normalize('source/utils/core/doctor.ts'),
  path.normalize('source/utils/core/runUpdate.ts'),
  path.normalize('source/utils/core/updateCheck.ts'),
  path.normalize('source/utils/execution/sessionCommandPlane.ts'),
]);

let allowedConsoleCount = 0;
let businessConsoleCount = 0;
const businessConsoleDetails = [];

let homedirLeaksCount = 0;
const homedirLeaksDetails = [];

let emptyCatchCount = 0;
const emptyCatchByFile = {};

let rootLoggerCallsCount = 0;
const rootLoggerByFile = {};

for (const file of sourceFiles) {
  const rel = path.normalize(path.relative(process.cwd(), file));
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // 1. Console Calls
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (/console\.(log|error|warn|info|debug)\(/.test(line)) {
      totalConsole++;
      consoleByFile[rel] = (consoleByFile[rel] || 0) + 1;
      if (ALLOWED_STANDALONE.has(rel)) {
        allowedConsoleCount++;
      } else {
        businessConsoleCount++;
        businessConsoleDetails.push({ file: rel, line: idx + 1, text: trimmed });
      }
    }
  });

  // 2. Homedir Storage Leaks (path.join(homedir(), '.snow' ...) bypassing snowContext)
  if (!rel.endsWith('source' + path.sep + 'utils' + path.sep + 'core' + path.sep + 'snowContext.ts')) {
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (/homedir\(\)[^;\n]*['"]\.snow['"]/.test(line)) {
        homedirLeaksCount++;
        homedirLeaksDetails.push({ file: rel, line: idx + 1, text: trimmed });
      }
    });
  }

  // 3. Defensive Empty Catches (catch blocks with 0 statements or only comments)
  const catchRegex = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;
  let match;
  while ((match = catchRegex.exec(content)) !== null) {
    const body = match[1].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (body === '') {
      emptyCatchCount++;
      emptyCatchByFile[rel] = (emptyCatchByFile[rel] || 0) + 1;
    }
  }

  // 4. Root Logger Direct Calls (calling logger.debug/info directly instead of derived child logger)
  if (!rel.endsWith('source' + path.sep + 'utils' + path.sep + 'core' + path.sep + 'logger.ts') &&
      !rel.endsWith('source' + path.sep + 'cli.tsx')) {
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (/\blogger\.(debug|info|warn|error)\(/.test(trimmed)) {
        rootLoggerCallsCount++;
        rootLoggerByFile[rel] = (rootLoggerByFile[rel] || 0) + 1;
      }
    });
  }
}

console.log(JSON.stringify({
  sourceFilesCount: sourceFiles.length,
  console: {
    total: totalConsole,
    allowedCLIStandalone: allowedConsoleCount,
    businessDomainLeaks: businessConsoleCount,
    businessDomainDetails: businessConsoleDetails
  },
  homedirLeaks: {
    total: homedirLeaksCount,
    details: homedirLeaksDetails
  },
  defensiveCatches: {
    totalCompletelySilent: emptyCatchCount,
    filesCount: Object.keys(emptyCatchByFile).length,
    topFiles: Object.entries(emptyCatchByFile).sort((a,b) => b[1] - a[1]).slice(0, 20)
  },
  loggerHierarchy: {
    totalDirectRootLoggerCalls: rootLoggerCallsCount,
    filesCount: Object.keys(rootLoggerByFile).length,
    topFiles: Object.entries(rootLoggerByFile).sort((a,b) => b[1] - a[1]).slice(0, 15)
  }
}, null, 2));
