import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

// Allowed exceptions for explicit standalone CLI commands or headless streaming
const ALLOWED_CONSOLE_STANDALONE = new Set([
  path.normalize('source/cli.tsx'),
  path.normalize('source/ui/pages/HeadlessModeScreen.tsx'),
  path.normalize('source/utils/core/doctor.ts'),
  path.normalize('source/utils/core/runUpdate.ts'),
  path.normalize('source/utils/core/updateCheck.ts'),
]);

// Helper to recursively collect files
function collectSourceFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'vendor' && entry.name !== 'test') {
        results = results.concat(collectSourceFiles(fullPath));
      }
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

test('zeroConsoleLeakGuard: core logger and test helpers have zero console leaks', (t) => {
  const coreFiles = [
    path.normalize('source/utils/core/logger.ts'),
    path.normalize('source/test/helpers/memoryLogSink.ts'),
  ];

  for (const file of coreFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const hasConsole = /console\.(log|error|warn|info|debug)\(/.test(line);
      t.false(
        hasConsole,
        `Prohibited console call in core module ${file}:${idx + 1}: ${trimmed}`,
      );
    });
  }
});

test('zeroConsoleLeakGuard: ratchet baseline prevents new console leaks in source tree', (t) => {
  const rootDir = path.resolve('source');
  const allFiles = collectSourceFiles(rootDir);

  const violations: string[] = [];

  for (const file of allFiles) {
    const relativePath = path.normalize(path.relative(process.cwd(), file));
    if (ALLOWED_CONSOLE_STANDALONE.has(relativePath)) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      if (/console\.(log|error|warn|info|debug)\(/.test(line)) {
        violations.push(`${relativePath}:${idx + 1}: ${trimmed}`);
      }
    });
  }

  // The total violations must not exceed the ratchet baseline of 252,
  // preventing any new accidental console leaks across the codebase.
  t.true(
    violations.length <= 252,
    `Console call count exceeded ratchet threshold (found ${violations.length}):\n` +
      violations.slice(0, 10).join('\n'),
  );
});
