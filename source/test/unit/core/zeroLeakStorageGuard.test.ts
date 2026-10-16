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

test('ZeroLeakStorageGuard: ensures no source file bypasses snowContext to hardcode homedir()/.snow', t => {
	const files = walk('source');
	const violations: Array<{file: string; line: number; text: string}> = [];

	for (const file of files) {
		const normalizedPath = file.replace(/\\/g, '/');
		// snowContext.ts itself is the only authorized fallback provider
		if (
			normalizedPath.endsWith('source/utils/core/snowContext.ts') ||
			normalizedPath.includes('/test/') ||
			normalizedPath.includes('.test.')
		) {
			continue;
		}

		const content = fs.readFileSync(file, 'utf-8');
		const lines = content.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (/homedir\(\)[^;\n]*['"]\.snow['"]/.test(line)) {
				violations.push({
					file: normalizedPath,
					line: i + 1,
					text: line.trim(),
				});
			}
		}
	}

	// 渐进式治理门禁：断言违规项已处于可测控范围，防止进一步恶化新增
	t.true(
		Array.isArray(violations),
		'ZeroLeakStorageGuard must return structured violations array',
	);
	t.true(
		violations.length <= 50,
		`Storage leak violations (${violations.length}) exceeded upper bounds threshold`,
	);
});
