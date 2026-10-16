import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (!['node_modules', 'bundle', '.git', 'test', 'vendor', 'dist'].includes(ent.name)) {
				walk(full, out);
			}
		} else if (/\.(ts|tsx)$/.test(ent.name)) {
			out.push(path.resolve(full).replace(/\\/g, '/'));
		}
	}
	return out;
}

/**
 * 架构循环依赖检测探针：
 * 采用 DFS 有向图强连通环路分析，设立软门限棘轮（Ratchet），
 * 确保全工程绝不新增任何跨模块循环引用！
 */
function findCircularDependencies(): Array<string[]> {
	const files = walk('source');
	const fileSet = new Set(files);
	const adj = new Map<string, string[]>();

	for (const file of files) {
		const content = fs.readFileSync(file, 'utf-8');
		const importRegex = /(?:import|export)(?!\s+type\s+)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g;
		const deps: string[] = [];
		let m: RegExpExecArray | null;
		const dir = path.dirname(file);

		while ((m = importRegex.exec(content)) !== null) {
			let target = path.resolve(dir, m[1] ?? '').replace(/\\/g, '/');
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

	const visited = new Map<string, number>();
	const stack: string[] = [];
	const rawCycles: string[][] = [];

	function dfs(u: string) {
		visited.set(u, 1);
		stack.push(u);
		const neighbors = adj.get(u) || [];
		for (const v of neighbors) {
			if (visited.get(v) === 1) {
				const cycle = stack.slice(stack.indexOf(v));
				cycle.push(v);
				rawCycles.push(cycle);
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

	return rawCycles;
}

test('ArchitectureCycleGuard: enforces strict cycle ratchet limit to prevent new circular dependencies', t => {
	const cycles = findCircularDependencies();

	// 基线棘轮机制：目前历史遗留环路严格锁死为 10 处
	// 伴随架构治理只降不升，严禁新增任何跨域循环引用！
	const CURRENT_MAX_CYCLE_RATCHET = 10;

	t.true(
		cycles.length <= CURRENT_MAX_CYCLE_RATCHET,
		`Circular dependencies count (${cycles.length}) exceeded the strict ratchet limit (${CURRENT_MAX_CYCLE_RATCHET})! Cycles:\n` +
			cycles.map((c, i) => `Cycle #${i + 1}: ${c.map(p => path.basename(p)).join(' -> ')}`).join('\n'),
	);
});
