import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name !== 'node_modules' && ent.name !== 'bundle' && ent.name !== '.git' && ent.name !== 'dist') {
				walk(full, out);
			}
		} else if (/\.(ts|tsx)$/.test(ent.name)) {
			out.push(full);
		}
	}
	return out;
}

/**
 * ZeroLoggerNameGuard:
 * 强门禁铁律：全工程任何通过 logger.child(...) 派生的局部变量名，
 * 必须且只能命名为 `const log`！
 * 
 * 严禁使用任何 `pageLog`、`compLog`、`subAgentLogger`、`myLogger` 等自定义别名。
 * 这保证了：
 * 1. 纳秒级肌肉记忆：所有文件统一通过 `log.debug/info/warn/error` 进行记录；
 * 2. 避免变量遮蔽与命名空间歧义；
 * 3. 静态门控可以以确定性正则拦截未受检的调用。
 */
test('ZeroLoggerNameGuard: enforces strictly `const log = logger.child(...)` naming standard across entire codebase', t => {
	const files = walk('source');
	const violations: Array<{file: string; line: number; varName: string; domain: string; snippet: string}> = [];

	for (const file of files) {
		const normalized = file.replace(/\\/g, '/');
		// 豁免测试套件和核心微内核 logger.ts
		if (normalized.includes('/test/') || normalized.includes('.test.')) continue;
		if (normalized.endsWith('source/utils/core/logger.ts')) continue;

		const content = fs.readFileSync(file, 'utf-8');

		// 匹配形如 const xxx = logger.child(...) 或 let xxx = child(...)
		const childDeclRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)?child\(\s*['"]([^'"]+)['"]/g;
		let match: RegExpExecArray | null;

		while ((match = childDeclRegex.exec(content)) !== null) {
			const varName = match[1] ?? '';
			const domain = match[2] ?? '';

			if (varName !== 'log') {
				const line = content.substring(0, match.index).split('\n').length;
				violations.push({
					file: normalized,
					line,
					varName,
					domain,
					snippet: match[0],
				});
			}
		}
	}

	t.is(
		violations.length,
		0,
		`Non-standard logger variable names detected! Every derived logger MUST be named 'const log'. Violations:\n${JSON.stringify(violations, null, 2)}`,
	);
});

test('ZeroLoggerNameGuard: ablation & anti-ablation detects illicit logger names correctly', t => {
	const regex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)?child\(\s*['"]([^'"]+)['"]/g;

	// 正例：标准声明
	const validSnippet = "const log = logger.child('mcp:aceCodeSearch');";
	let match = regex.exec(validSnippet);
	t.truthy(match);
	t.is(match?.[1], 'log');

	// 消融测试 (Ablation)：非法别名必须被精准捕获拦截
	const illegalSnippets = [
		"const pageLog = logger.child('ui:pages');",
		"const compLog = logger.child('ui:components');",
		"const configLogger = logger.child('config:api');",
		"let customLogger = logger.child('custom');",
		"var tempLog = logger.child('temp');",
	];

	for (const snippet of illegalSnippets) {
		const testRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:[a-zA-Z0-9_$]+\.)?child\(\s*['"]([^'"]+)['"]/g;
		const m = testRegex.exec(snippet);
		t.truthy(m, `Should match child declaration in snippet: ${snippet}`);
		t.not(m?.[1], 'log', `Var name '${m?.[1]}' must not be equal to 'log'`);
	}
});
