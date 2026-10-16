import test from 'ava';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

export interface DynamicImportViolation {
	raw: string;
	line: number;
	argKind: string;
	reason: string;
}

/**
 * 基于 TypeScript 权威 AST（抽象语法树）解析器与模式匹配
 * 彻底防御正则漏报（如跨行模板、隐式嵌套、转义反引号、多行注释中包含语法特征等）
 */
export function findDynamicInterpolationViolations(
	content: string,
	filePath?: string,
): DynamicImportViolation[] {
	const violations: DynamicImportViolation[] = [];
	const normalizedPath = filePath?.replace(/\\/g, '/');

	// 明确受信任的外部插件运行时沙箱装载点（User Plugin Dynamic Extensibility Sandbox）
	const isTrustedPluginSandboxLoader = Boolean(
		normalizedPath &&
		(
			normalizedPath.includes('source/utils/plugins/') ||
			normalizedPath.includes('source/mcp/engines/websearch/index.ts') ||
			normalizedPath.includes('source/ui/components/common/statusline/useStatusLineHooks.ts')
		),
	);

	const sourceFile = ts.createSourceFile(
		filePath || 'probe.ts',
		content,
		ts.ScriptTarget.Latest,
		true, // setParentNodes
	);

	function visit(node: ts.Node) {
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			const arg = node.arguments[0];
			const {line} = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
			const rawText = node.getText(sourceFile).replace(/\s+/g, ' ');

			if (!arg) {
				violations.push({
					raw: rawText,
					line: line + 1,
					argKind: 'None',
					reason: 'Dynamic import call must provide a target module argument',
				});
				return;
			}

			// 1. 静态字符串字面量: '...' 或 "..."
			const isStringLiteral = ts.isStringLiteral(arg);

			// 2. 静态模板字面量（无插值替换）: `...`
			const isNoSubTemplate = ts.isNoSubstitutionTemplateLiteral(arg);

			if (isStringLiteral || isNoSubTemplate) {
				// 纯静态确定性边，完全符合 AST 静态图分析
				return;
			}

			// 3. 外部热重载沙箱特权通道判定
			if (isTrustedPluginSandboxLoader) {
				// 沙箱装载必须严格限制为单标识符变量 moduleUrl
				if (ts.isIdentifier(arg) && arg.text === 'moduleUrl') {
					return;
				}
			}

			// 4. 判定非法变体并捕获详细 AST 节点信息
			let reason = `Dynamic import expression argument is not a static literal (AST: ${ts.SyntaxKind[arg.kind]})`;
			if (ts.isTemplateExpression(arg)) {
				reason = 'Template literal with ${} interpolation creates non-deterministic AST graph edges';
			} else if (ts.isBinaryExpression(arg)) {
				reason = 'String concatenation with operator (+) creates non-deterministic AST graph edges';
			} else if (ts.isIdentifier(arg)) {
				reason = `Variable identifier '${arg.text}' used directly in internal dynamic import without static registry`;
			}

			violations.push({
				raw: rawText.substring(0, 100),
				line: line + 1,
				argKind: ts.SyntaxKind[arg.kind] ?? 'Unknown',
				reason,
			});
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
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
	const allViolations: Array<{file: string; line: number; raw: string; reason: string}> = [];

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
				reason: v.reason,
			});
		}
	}

	if (allViolations.length > 0) {
		t.log('Detected dynamic import interpolation violations:');
		for (const v of allViolations) {
			t.log(`  -> ${v.file}:${v.line} [${v.reason}] => ${v.raw}`);
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
	// 1. 合法正向模式 (Positive Cases)
	const validContent = `
		const a = await import('./valid-module.js');
		const b = await import("../core/logger.js");
		const c = await import(\`./static-template.js\`);
		// 带有复杂多行注释或 @vite-ignore 标签的合法导入
		const d = await import(/* @vite-ignore */ 'tar');
		const e = await import(
			// 内部换行注释
			'tiktoken'
		);
		// 注释中的假动态导入，AST 必须完全免疫，不得误报
		// const fake = import('./fake/' + dynamic);
		/* const fake2 = import(\`./\${fake}\`); */
	`;
	t.is(findDynamicInterpolationViolations(validContent).length, 0, 'Legitimate static imports and commented imports must pass');

	// 2. 非法反向变体 (Negative Cases / Illicit Mutation Patterns)
	// 变体 A: 变量直传
	const illegalVariable = `const mod = await import(dynamicPath);`;
	const varRes = findDynamicInterpolationViolations(illegalVariable);
	t.is(varRes.length, 1);
	t.is(varRes[0]?.argKind, 'Identifier');

	// 变体 B: 模板字符串插值
	const illegalTemplateInterpolation = 'const mod = await import(`./subagents/${agentName}.js`);';
	const tplRes = findDynamicInterpolationViolations(illegalTemplateInterpolation);
	t.is(tplRes.length, 1);
	t.is(tplRes[0]?.argKind, 'TemplateExpression');

	// 变体 C: 多项二元操作符字符串拼接
	const illegalConcatenation = `const mod = await import('./plugins/' + pluginName + '.js');`;
	const binRes = findDynamicInterpolationViolations(illegalConcatenation);
	t.is(binRes.length, 1);
	t.is(binRes[0]?.argKind, 'BinaryExpression');

	// 变体 D: 三元条件表达式动态导入
	const illegalConditional = `const mod = await import(isProd ? './prod.js' : './dev.js');`;
	const condRes = findDynamicInterpolationViolations(illegalConditional);
	t.is(condRes.length, 1);
	t.is(condRes[0]?.argKind, 'ConditionalExpression');

	// 变体 E: 函数调用返回值作为动态导入
	const illegalFnCall = `const mod = await import(resolvePluginPath('any'));`;
	const callRes = findDynamicInterpolationViolations(illegalFnCall);
	t.is(callRes.length, 1);
	t.is(callRes[0]?.argKind, 'CallExpression');

	// 变体 F: 数组/字典索引动态访问
	const illegalIndexed = `const mod = await import(MODULE_MAP[idx]);`;
	const idxRes = findDynamicInterpolationViolations(illegalIndexed);
	t.is(idxRes.length, 1);
	t.is(idxRes[0]?.argKind, 'ElementAccessExpression');
});
