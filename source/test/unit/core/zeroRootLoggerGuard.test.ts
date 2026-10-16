import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
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

test('ZeroRootLoggerGuard: enforces absolute zero direct root logger calls across entire business domain', t => {
	const files = walk('source');
	const violations: Array<{file: string; line: number; snippet: string}> = [];

	for (const file of files) {
		const normalized = file.replace(/\\/g, '/');
		// 仅豁免测试套件和微内核本体 logger.ts；cli.tsx 也已全面纳入 const log = logger.child('cli:main') 标准化！
		if (normalized.includes('/test/') || normalized.includes('.test.')) continue;
		if (normalized.endsWith('source/utils/core/logger.ts')) continue;

		const content = fs.readFileSync(file, 'utf-8');
		const lines = content.split('\n');
		lines.forEach((line, idx) => {
			const trimmed = line.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
			if (/\blogger\.(debug|info|warn|error)\(/.test(trimmed)) {
				violations.push({
					file: normalized,
					line: idx + 1,
					snippet: trimmed.slice(0, 100),
				});
			}
		});
	}

	t.is(
		violations.length,
		0,
		`Found direct root logger calls in business domain! All business modules must declare const log = logger.child('domain:submodule'). Violations:\n${JSON.stringify(violations, null, 2)}`,
	);
});
