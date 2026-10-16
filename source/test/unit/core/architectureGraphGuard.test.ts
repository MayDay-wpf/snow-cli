import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
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

test('ArchitectureGraphGuard: ensures 0 circular dependency cycles across all source modules', t => {
	const files = walk('source');
	const fileSet = new Set(files);
	const adj = new Map<string, string[]>();

	for (const file of files) {
		const content = fs.readFileSync(file, 'utf-8');
		// Match runtime import/export statements, ignoring static `import type`
		const importRegex = /(?:import|export)(?!\s+type\s+)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
		const deps: string[] = [];
		let m: RegExpExecArray | null;
		const dir = path.dirname(file);
		while ((m = importRegex.exec(content)) !== null) {
			let target = path.resolve(dir, m[1]!).replace(/\\/g, '/');
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

	// DFS cycle detection
	const visited = new Map<string, number>();
	const stack: string[] = [];
	const cycles: string[][] = [];

	function dfs(u: string) {
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

	const formattedCycles = cycles.map(c =>
		c.map(f => path.relative(process.cwd(), f).replace(/\\/g, '/')).join(' -> '),
	);

	t.deepEqual(
		formattedCycles,
		[],
		`Architecture Violation: Found ${cycles.length} runtime circular dependencies in source graph:\n` +
			formattedCycles.join('\n'),
	);
});
