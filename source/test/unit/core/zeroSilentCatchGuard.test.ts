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

/**
 * 扫描盲目吞错反模式：
 * 匹配 catch (...) {} 或 catch {}，中间只有空白字符或完全无执行语句。
 */
function scanSilentCatches(content: string): Array<{line: number; snippet: string}> {
	const silentCatches: Array<{line: number; snippet: string}> = [];
	const regex = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const body = match[1]?.trim() ?? '';
		// 滤掉包含 logger / console / return / throw 等语句的 catch
		const codeStatements = body
			.split('\n')
			.map(l => l.trim())
			.filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));

		if (codeStatements.length === 0) {
			const line = content.substring(0, match.index).split('\n').length;
			silentCatches.push({
				line,
				snippet: match[0].replace(/\s+/g, ' ').slice(0, 80),
			});
		}
	}

	return silentCatches;
}

test('ZeroSilentCatchGuard: enforces ratchet threshold on blind silent catch {} blocks', t => {
	const files = walk('source');
	const allViolations: Array<{file: string; line: number; snippet: string}> = [];

	for (const file of files) {
		const normalized = file.replace(/\\/g, '/');
		if (normalized.includes('/test/') || normalized.includes('.test.')) {
			continue;
		}

		const content = fs.readFileSync(file, 'utf-8');
		const fileViolations = scanSilentCatches(content);
		for (const v of fileViolations) {
			allViolations.push({
				file: normalized,
				line: v.line,
				snippet: v.snippet,
			});
		}
	}

	// 基线棘轮机制：原先全量为 307 处
	// 历经全域深度治理与可观测性重构，外层 UI/Hooks、业务域与四大中枢已系统性彻底清零（0 盲目吞错）
	// 棘轮指标终极归零锁死，严禁全库新增任何未受检或静默吞错代码！
	const CURRENT_MAX_SILENT_CATCH_RATCHET = 0;

	t.is(
		allViolations.length,
		CURRENT_MAX_SILENT_CATCH_RATCHET,
		`Silent catch blocks count (${allViolations.length}) must be strictly 0! Violations: ${JSON.stringify(allViolations, null, 2)}`,
	);
});
