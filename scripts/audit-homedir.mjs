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

const files = walk('source/utils');
const unrouted = [];

for (const f of files) {
	const content = fs.readFileSync(f, 'utf-8');
	const regex = /homedir\(\)[^;\n]*['"]\.snow['"]/g;
	let m;
	while ((m = regex.exec(content)) !== null) {
		unrouted.push({file: f.replace(/\\/g, '/'), match: m[0]});
	}
}

console.log('Unrouted .snow usages count:', unrouted.length);
console.log(JSON.stringify(unrouted, null, 2));
