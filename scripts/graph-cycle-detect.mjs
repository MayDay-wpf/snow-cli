import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (!['node_modules', 'bundle', '.git', 'test', 'vendor'].includes(ent.name)) {
				walk(full, out);
			}
		} else if (/\.(ts|tsx)$/.test(ent.name)) {
			out.push(path.resolve(full).replace(/\\/g, '/'));
		}
	}
	return out;
}

const files = walk('source');
const fileSet = new Set(files);
const adj = new Map();

for (const file of files) {
	const content = fs.readFileSync(file, 'utf-8');
	// Match imports and exports that are NOT type-only
	// e.g. "import type ..." or "export type ..." are purely static TS types erased at runtime
	const importRegex = /(?:import|export)(?!\s+type\s+)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
	const deps = [];
	let m;
	const dir = path.dirname(file);
	while ((m = importRegex.exec(content)) !== null) {
		let target = path.resolve(dir, m[1]).replace(/\\/g, '/');
		// Remove .js extension if present
		if (target.endsWith('.js')) {
			target = target.slice(0, -3);
		}
		const candidateTs = target + '.ts';
		const candidateTsx = target + '.tsx';
		const candidateIndexTs = target + '/index.ts';
		const candidateIndexTsx = target + '/index.tsx';
		if (fileSet.has(candidateTs)) deps.push(candidateTs);
		else if (fileSet.has(candidateTsx)) deps.push(candidateTsx);
		else if (fileSet.has(candidateIndexTs)) deps.push(candidateIndexTs);
		else if (fileSet.has(candidateIndexTsx)) deps.push(candidateIndexTsx);
	}
	adj.set(file, deps);
}

// DFS cycle detect
const visited = new Map();
const stack = [];
const cycles = [];

function dfs(u) {
	visited.set(u, 1);
	stack.push(u);
	const neighbors = adj.get(u) || [];
	for (const v of neighbors) {
		if (visited.get(v) === 1) {
			const cycle = stack.slice(stack.indexOf(v));
			cycle.push(v);
			cycles.push(cycle);
		} else if (!visited.has(v)) {
			dfs(v);
		}
	}
	stack.pop();
	visited.set(u, 2);
}

for (const file of files) {
	if (!visited.has(file)) {
		dfs(file);
	}
}

console.log('Total source files analyzed:', files.length);
console.log('Total directed edges analyzed:', Array.from(adj.values()).reduce((acc, c) => acc + c.length, 0));
console.log('Total Circular Dependency Cycles detected:', cycles.length);
if (cycles.length > 0) {
	console.log('\nAll Cycles Detected:');
	cycles.forEach((c, i) => {
		console.log(`\nCycle #${i + 1} (${c.length - 1} hops):`);
		c.forEach(f => console.log('  -> ' + path.relative('source', f).replace(/\\/g, '/')));
	});
}
