import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (!['node_modules', 'bundle', '.git', 'dist', 'vendor'].includes(ent.name)) {
				walk(full, out);
			}
		} else if (/\.(ts|tsx)$/.test(ent.name)) {
			out.push(full);
		}
	}
	return out;
}

function cleanImportArg(raw: string): string {
	// 移除注释 /* ... */ 或 // ...
	return raw
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\r\n]*/g, '')
		.trim();
}

/**
 * 核心检查规则：扫描 import(...) 调用
 * 判定标准：内部业务代码的 import(...) 参数必须是纯字符串字面量
 * 外部热加载扩展点（如 ~/.snow/plugin/）允许通过 moduleUrl 加载，其他内部业务绝对禁止变量拼接
 */
export function findDynamicInterpolationViolations(
	content: string,
	filePath?: string,
): Array<{raw: string; line: number}> {
	const violations: Array<{raw: string; line: number}> = [];

	// 允许外部用户热重载插件加载器（User-Plugin Dynamic Extensibility Points）
	const isUserPluginLoader = filePath && (
		filePath.includes('source/utils/plugins/') ||
		filePath.includes('source/mcp/engines/websearch/index.ts') ||
		filePath.includes('source/ui/components/common/statusline/useStatusLineHooks.ts')
	);

	// 正则匹配所有 import(...)，支持换行和内联注释
	const importRegex = /\bimport\s*\(([\s\S]*?)\)/g;
	let match: RegExpExecArray | null;

	while ((match = importRegex.exec(content)) !== null) {
		const fullCall = match[0] ?? '';
		const rawArg = match[1] ?? '';
		const arg = cleanImportArg(rawArg);

		// 如果本身没有任何参数（如注释掉的空调用），忽略
		if (!arg) continue;

		// 计算行号
		const offset = match.index;
		const line = content.substring(0, offset).split('\n').length;

		// 纯字符串字面量合法判定：以 ' 或 " 开头和结尾
		const isSingleQuoted = /^'[^'\r\n]+'$/.test(arg);
		const isDoubleQuoted = /^"[^"\r\n]+"$/.test(arg);
		// 允许不含 ${} 插值的简单反引号模板字符串 `foo/bar.js`
		const isStaticTemplate = /^`[^`$\r\n]+`$/.test(arg);

		if (isSingleQuoted || isDoubleQuoted || isStaticTemplate) {
			continue;
		}

		// 用户插件加载器特殊豁免（必须命名为 moduleUrl 并且有合法隔离）
		if (isUserPluginLoader && arg === 'moduleUrl') {
			continue;
		}

		violations.push({raw: fullCall.replace(/\s+/g, ' ').substring(0, 80), line});
	}

	return violations;
}

/**
 * ZeroDynamicInterpolationGuard:
 * 架构物理门禁：全仓禁止任何动态计算/字符串插值/变量拼接的 import(...)！
 *
 * 契约铁律：
 * 1. 允许：基于纯静态字符串字面量的延迟加载，如 import('../utils/config.js')，用于按需冷启动或切断环路；
 * 2. 绝对禁止：import('./subagents/' + name) 或 import(`./plugins/${pluginId}.js`) 等动态拼接；
 * 3. 规范替代方案：必须使用静态自注册字典（Static Registry Pattern），保证 AST 分析图 100% 形式化确定。
 */
test('ZeroDynamicInterpolationGuard: enforces strictly static string literal imports across entire codebase', t => {
	const files = walk('source');
	const allViolations: Array<{file: string; line: number; raw: string}> = [];

	for (const file of files) {
		const normalized = file.replace(/\\/g, '/');
		// 豁免测试用例自身
		if (normalized.includes('/test/') || normalized.includes('.test.')) continue;

		const content = fs.readFileSync(file, 'utf-8');
		const violations = findDynamicInterpolationViolations(content, normalized);

		for (const v of violations) {
			allViolations.push({
				file: normalized,
				line: v.line,
				raw: v.raw,
			});
		}
	}

	if (allViolations.length > 0) {
		t.log('Detected dynamic import interpolation violations:');
		for (const v of allViolations) {
			t.log(`  -> ${v.file}:${v.line} => ${v.raw}`);
		}
	}

	// 零容忍硬门禁：违规数必须绝对等于 0
	t.is(
		allViolations.length,
		0,
		`Found ${allViolations.length} dynamic import interpolation violations! All dynamic imports must use static string literals or Static Registry mapping.`,
	);
});

/**
 * 消融与反消融测试（Ablation & Anti-Ablation Verification）
 * 证明守门探针能够精准探测各种非法变体并放行合法形态
 */
test('ZeroDynamicInterpolationGuard: ablation & anti-ablation detects illicit dynamic imports correctly', t => {
	// 合法正向模式 (Positive Cases)
	const validContent = `
		const a = await import('./valid-module.js');
		const b = await import("../core/logger.js");
		const c = await import(\`./static-template.js\`);
	`;
	t.is(findDynamicInterpolationViolations(validContent).length, 0, 'Legitimate static imports must pass');

	// 各种非法反向变体 (Negative Cases / Illicit Patterns)
	const illegalVariable = `const mod = await import(dynamicPath);`;
	t.is(findDynamicInterpolationViolations(illegalVariable).length, 1, 'Variable import must be flagged');

	const illegalTemplateInterpolation = 'const mod = await import(`./subagents/${agentName}.js`);';
	t.is(findDynamicInterpolationViolations(illegalTemplateInterpolation).length, 1, 'Template interpolation must be flagged');

	const illegalConcatenation = `const mod = await import('./plugins/' + pluginName + '.js');`;
	t.is(findDynamicInterpolationViolations(illegalConcatenation).length, 1, 'String concatenation must be flagged');
});
