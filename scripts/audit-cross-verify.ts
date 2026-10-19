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

// 1. Logger domains statistics
const namespaceMap: Record<string, {count: number; files: string[]}> = {};
const logVariableNames: Record<string, number> = {};
const unnamespacedLoggerUsages: Array<{file: string; line: number; match: string}> = [];
const consoleUsages: Array<{file: string; line: number; match: string}> = [];
const emptyCatches: Array<{file: string; line: number; snippet: string}> = [];
const rawHomedirSnow: Array<{file: string; line: number; match: string}> = [];

const ROOT_LOGGER_IGNORE = [
	'source/utils/core/logger.ts',
	'source/utils/core/snowContext.ts',
];

const nonLogVariableDeclarations: Array<{file: string; varName: string; domain: string}> = [];

for (const file of files) {
	const norm = file.replace(/\\/g, '/');
	if (norm.includes('/test/') || norm.includes('.test.')) continue;

	const content = fs.readFileSync(file, 'utf-8');
	const lines = content.split('\n');

	// A. Check logger child instantiation
	const childRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)?child\(\s*['"]([^'"]+)['"]/g;
	let match: RegExpExecArray | null;
	while ((match = childRegex.exec(content)) !== null) {
		const varName = match[1];
		const domain = match[2];
		logVariableNames[varName] = (logVariableNames[varName] || 0) + 1;
		if (varName !== 'log') {
			nonLogVariableDeclarations.push({file: norm, varName, domain});
		}
		if (!namespaceMap[domain]) {
			namespaceMap[domain] = {count: 0, files: []};
		}
		namespaceMap[domain].count++;
		if (!namespaceMap[domain].files.includes(norm)) {
			namespaceMap[domain].files.push(norm);
		}
	}

	// Also check direct logger.child('...') without const
	const directChildRegex = /logger\.child\(\s*['"]([^'"]+)['"]/g;
	while ((match = directChildRegex.exec(content)) !== null) {
		const domain = match[1];
		if (!namespaceMap[domain]) {
			namespaceMap[domain] = {count: 0, files: []};
		}
	}

	// B. Check direct calls to root logger (excluding logger.ts and logger.child)
	if (!ROOT_LOGGER_IGNORE.includes(norm)) {
		lines.forEach((lineText, idx) => {
			const trimmed = lineText.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
			const rootCallMatch = /logger\.(debug|info|warn|error|trace|fatal)\s*\(/.exec(lineText);
			if (rootCallMatch) {
				unnamespacedLoggerUsages.push({file: norm, line: idx + 1, match: trimmed});
			}
		});
	}

	// C. Check console.* usage (excluding zeroConsoleLeakGuard whitelists or safe files)
	lines.forEach((lineText, idx) => {
		const trimmed = lineText.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
		if (/console\.(log|info|warn|error|debug|trace)\s*\(/.test(trimmed)) {
			consoleUsages.push({file: norm, line: idx + 1, match: trimmed});
		}
	});

	// D. Check raw homedir / .snow path constructions bypassing snowContext
	lines.forEach((lineText, idx) => {
		const trimmed = lineText.trim();
		if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
		if (norm !== 'source/utils/core/snowContext.ts') {
			if (/(?:homedir\(\)|HOME|USERPROFILE)[^;]*['"]\.snow['"]/.test(lineText) ||
				/join\([^)]*['"]\.snow['"]\)/.test(lineText) && lineText.includes('homedir')) {
				rawHomedirSnow.push({file: norm, line: idx + 1, match: trimmed});
			}
		}
	});

	// E. Check silent catches
	const catchRegex = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;
	let cMatch: RegExpExecArray | null;
	while ((cMatch = catchRegex.exec(content)) !== null) {
		const body = cMatch[1]?.trim() ?? '';
		const stmts = body
			.split('\n')
			.map(l => l.trim())
			.filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));
		if (stmts.length === 0) {
			const lineNo = content.substring(0, cMatch.index).split('\n').length;
			emptyCatches.push({file: norm, line: lineNo, snippet: cMatch[0].replace(/\s+/g, ' ').slice(0, 80)});
		}
	}
}

// 2. Aggregate hierarchy layers
const layerStats: Record<string, {namespaces: string[]; totalInstantiations: number; filesCount: number}> = {
	'api': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'cli': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'commands': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'config': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'connection': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'conversation': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'core': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'execution': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'hooks': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'mcp': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'session': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'task': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'team': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'ui': {namespaces: [], totalInstantiations: 0, filesCount: 0},
	'other': {namespaces: [], totalInstantiations: 0, filesCount: 0},
};

const allFilesWithChild = new Set<string>();

for (const [ns, data] of Object.entries(namespaceMap)) {
	const topPrefix = ns.split(/[:.]/)[0];
	const layer = layerStats[topPrefix] ? topPrefix : 'other';
	layerStats[layer].namespaces.push(ns);
	layerStats[layer].totalInstantiations += data.count;
	for (const f of data.files) {
		allFilesWithChild.add(f);
	}
}

// Deduplicate filesCount per layer
for (const [layer, data] of Object.entries(layerStats)) {
	const layerFiles = new Set<string>();
	for (const ns of data.namespaces) {
		for (const f of namespaceMap[ns].files) {
			layerFiles.add(f);
		}
	}
	data.filesCount = layerFiles.size;
}

console.log(JSON.stringify(nonLogVariableDeclarations, null, 2));
