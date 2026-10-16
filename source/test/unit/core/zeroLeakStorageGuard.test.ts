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

	// 严苛零容忍门禁：全域业务代码 100% 杜绝直接 hardcode homedir()/.snow，必须统一收归 getGlobalSnowDir()
	t.deepEqual(
		violations,
		[],
		`Detected ${violations.length} storage leak violations bypassing getGlobalSnowDir():\n${JSON.stringify(violations, null, 2)}`,
	);
});
