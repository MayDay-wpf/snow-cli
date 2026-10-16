import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string): string[] {
	let res: string[] = [];
	for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, item.name);
		if (item.isDirectory()) {
			if (!['node_modules', '.git', 'dist', 'build'].includes(item.name)) {
				res.push(...walk(full));
			}
		} else if (item.name.endsWith('.ts') || item.name.endsWith('.tsx')) {
			res.push(full);
		}
	}
	return res;
}

const files = walk('source');
const targets: Array<{file: string; oldVar: string; domain: string}> = [];

for (const file of files) {
	const norm = file.replace(/\\/g, '/');
	if (norm.includes('/test/') || norm.includes('.test.')) continue;
	if (norm.endsWith('source/utils/core/logger.ts')) continue;

	const content = fs.readFileSync(file, 'utf-8');
	const childRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)?child\(\s*['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = childRegex.exec(content)) !== null) {
		const varName = match[1];
		const domain = match[2];
		if (varName !== 'log') {
			targets.push({file, oldVar: varName, domain});
		}
	}
}

console.log(`Found ${targets.length} non-standard logger variables to normalize.`);

for (const t of targets) {
	let content = fs.readFileSync(t.file, 'utf-8');

	// Replace declaration: const <oldVar> = ...child(
	const declRegex = new RegExp(`(const|let|var)\\s+${t.oldVar}\\s*=\\s*([a-zA-Z0-9_$.]+)\\.child\\(`, 'g');
	content = content.replace(declRegex, `$1 log = $2.child(`);

	// Replace usage: <oldVar>.(debug|info|warn|error|trace|fatal)
	const usageRegex = new RegExp(`\\b${t.oldVar}\\.(debug|info|warn|error|trace|fatal|startTimer)\\b`, 'g');
	content = content.replace(usageRegex, `log.$1`);

	fs.writeFileSync(t.file, content, 'utf-8');
	console.log(`Normalized: ${t.file} (${t.oldVar} -> log)`);
}

console.log('All non-standard logger variables normalized successfully!');
