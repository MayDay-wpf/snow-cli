import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name !== 'node_modules' && ent.name !== 'bundle' && ent.name !== '.git') {
				walk(full, out);
			}
		} else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
			out.push(full);
		}
	}
	return out;
}

const files = walk('source');
const envMap = new Map();

for (const f of files) {
	const content = fs.readFileSync(f, 'utf-8');
	const regex = /process\.env(?:\[\s*['"]([^'"]+)['"]\s*\]|\.([A-Za-z0-9_]+))/g;
	let m;
	while ((m = regex.exec(content)) !== null) {
		const key = m[1] || m[2];
		if (!envMap.has(key)) envMap.set(key, new Set());
		envMap.get(key).add(f.replace(/\\/g, '/'));
	}
}

const list = Array.from(envMap.entries())
	.map(([k, s]) => ({key: k, files: Array.from(s)}))
	.sort((a, b) => a.key.localeCompare(b.key));

console.log(JSON.stringify(list, null, 2));
