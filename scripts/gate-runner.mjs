#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

// ============================================================================
// Snow CLI 本地门控调度器 (Gate Runner)
// 1. fast (Smoke): 秒级验证核心契约与功能冒烟 (<5s)
// 2. core: 运行核心域集成用例 (<30s)
// 3. all: 全量测试回归
// ============================================================================

const profile = process.argv[2] || 'fast';

const PROFILES = {
	fast: [
		'source/test/canonical-path-node.test.ts',
		'source/test/mcp-circuit-breaker.test.ts',
		'source/test/color-science-engine.test.ts',
		'source/test/terminal-title-formatter.test.ts',
		'source/test/thinkingExtractor.test.ts',
	],
	core: [
		'source/test/canonical-path-node.test.ts',
		'source/test/mcp-circuit-breaker.test.ts',
		'source/test/mcp-circuit-breaker-integration.test.ts',
		'source/test/mcp-idle-cleanup-and-abort.test.ts',
		'source/test/mcp-process-tree-posix.test.ts',
		'source/test/terminal-exit-cleanups.test.ts',
	],
	session: [
		'source/test/session-auto-compress-active-task.test.ts',
		'source/test/session-compression-e2e.test.ts',
		'source/test/session-command-plane.test.ts',
		'source/test/session-resume-and-compact-resilience.test.ts',
		'source/test/sessionIdentityEnv.test.ts',
	],
	mcp: [
		'source/test/mcp-circuit-breaker.test.ts',
		'source/test/mcp-circuit-breaker-integration.test.ts',
		'source/test/mcp-idle-cleanup-and-abort.test.ts',
		'source/test/mcp-process-tree-posix.test.ts',
		'source/test/mcp-catalog-scheduler.test.ts',
		'source/test/mcp-jit-lifecycle.test.ts',
		'source/test/mcp-router-characterization.test.ts',
	],
	theme: [
		'source/test/color-science-engine.test.ts',
		'source/test/color-science-cdc-contract.test.ts',
		'source/test/color-science-i18n-contract.test.ts',
		'source/test/color-science-lifecycle-resources.test.ts',
	],
};

function run() {
	if (profile === 'all') {
		console.log('[GateRunner] Executing FULL test regression suite...');
		const result = spawnSync('npx', ['ava'], {
			stdio: 'inherit',
			shell: true,
		});
		process.exit(result.status ?? 1);
	}

	const suites = PROFILES[profile];
	if (!suites) {
		console.error(`[GateRunner] Unknown profile: "${profile}". Valid profiles: ${Object.keys(PROFILES).join(', ')}, all`);
		process.exit(2);
	}

	// === Tier 2: AOT Type Soundness Oracle (Step 0) ===
	console.log(`[GateRunner] [Step 0] Verifying TypeScript type soundness (tsc --noEmit)...`);
	const tscResult = spawnSync('npx', ['tsc', '--noEmit'], {
		stdio: 'inherit',
		shell: true,
	});
	if (tscResult.status !== 0) {
		console.error(`\n[GateRunner] [Step 0 FAILED] TypeScript type compilation failed. Fix type errors before running tests.`);
		process.exit(tscResult.status ?? 1);
	}
	console.log(`[GateRunner] [Step 0 PASSED] TypeScript types strictly sound.\n`);

	console.log(`[GateRunner] Profile [${profile}] executing ${suites.length} test suites...`);
	const avaArgs = ['node_modules/ava/entrypoints/cli.mjs', '--timeout=1m', ...suites];
	const result = spawnSync('node', avaArgs, {
		stdio: 'inherit',
		shell: true,
	});

	if (result.status !== 0) {
		console.error(`\n[GateRunner] Profile [${profile}] FAILED with exit code ${result.status}`);
		process.exit(result.status ?? 1);
	}

	console.log(`\n[GateRunner] Profile [${profile}] PASSED successfully.`);
}

run();
