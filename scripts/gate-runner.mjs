#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

// ============================================================================
// Snow CLI 本地门控调度器 (Gate Runner)
// 依据 testing-scenario-cli 与 test-engineering-conventions:
// 1. fast (Smoke): 秒级验证核心纯逻辑单元测试与关键契约 (<5s)
// 2. core: 运行核心域集成用例 (<30s)
// 3. all: 全量测试回归
// ============================================================================

const profile = process.argv[2] || 'fast';

const PROFILES = {
	fast: [
		'source/test/unit/core/canonicalPathNode.test.ts',
		'source/test/unit/core/structuredPath.test.ts',
		'source/test/unit/core/proxyUtils.test.ts',
		'source/test/unit/core/textUtils.test.ts',
		'source/test/unit/core/version.test.ts',
		'source/test/unit/core/fileUtils.test.ts',
		'source/test/unit/core/cleanupService.test.ts',
		'source/test/unit/core/notebookManager.test.ts',
		'source/test/unit/core/usageHistory.test.ts',
		'source/test/unit/config/toolAndSkillConfig.test.ts',
		'source/test/unit/codebase/gitignoreValidator.test.ts',
		'source/test/unit/i18n/i18nParity.test.ts',
		'source/test/unit/api/apiGuardsAndEndpoints.test.ts',
		'source/test/unit/api/decisionModelContract.test.ts',
		'source/test/unit/api/rerankBudget.test.ts',
		'source/test/unit/commands/toolNamesBatchParser.test.ts',
		'source/test/unit/execution/commandExecutor.test.ts',
		'source/test/unit/execution/sensitiveCommandMatrix.test.ts',
		'source/test/unit/mcp/crlfAndEncodingFidelity.test.ts',
		'source/test/unit/buddy/companion.test.ts',
		'source/test/unit/prompt/promptHelpers.test.ts',
		'source/test/unit/agents/bashOutputSummaryAgent.test.ts',
		'source/test/integration/core/streamGuards.test.ts',
		'source/test/integration/core/unifiedSettings.test.ts',
		'source/test/integration/core/retryUtils.test.ts',
		'source/test/integration/config/legacyConfigMigration.test.ts',
		'source/test/integration/codebase/hashBasedSnapshotReversible.test.ts',
		'source/test/unit/config/envFabricAndSnowContext.test.ts',
		'source/test/unit/core/zeroLeakStorageGuard.test.ts',
		'source/test/unit/mcp/mcpCircuitBreaker.test.ts',
		'source/test/unit/theme/colorScienceEngine.test.ts',
		'source/test/unit/core/loggerTest.test.ts',
	],
	core: [
		'source/test/unit/core/canonicalPathNode.test.ts',
		'source/test/unit/core/proxyUtils.test.ts',
		'source/test/unit/core/textUtils.test.ts',
		'source/test/unit/core/version.test.ts',
		'source/test/unit/core/fileUtils.test.ts',
		'source/test/unit/core/cleanupService.test.ts',
		'source/test/unit/core/notebookManager.test.ts',
		'source/test/unit/core/usageHistory.test.ts',
		'source/test/integration/core/streamGuards.test.ts',
		'source/test/integration/core/unifiedSettings.test.ts',
		'source/test/integration/core/retryUtils.test.ts',
		'source/test/unit/mcp/mcpCircuitBreaker.test.ts',
		'source/test/integration/mcp/mcpCircuitBreakerIntegration.test.ts',
		'source/test/integration/mcp/mcpIdleCleanupAndAbort.test.ts',
		'source/test/integration/mcp/mcpProcessTreePosix.test.ts',
		'source/test/integration/core/terminalExitCleanups.test.ts',
		'source/test/unit/core/loggerTest.test.ts',
	],
	session: [
		'source/test/integration/session/session-pending-messages-race.test.ts',
		'source/test/integration/session/session-auto-compress-active-task.test.ts',
		'source/test/integration/session/session-compression-e2e.test.ts',
		'source/test/integration/session/session-command-plane.test.ts',
		'source/test/unit/session/projectUtils.test.ts',
		'source/test/unit/session/chatExporter.test.ts',
		'source/test/integration/session/checkpointManager.test.ts',
		'source/test/integration/session/commandUsageManager.test.ts',
	],
	mcp: [
		'source/test/unit/mcp/mcpCircuitBreaker.test.ts',
		'source/test/integration/mcp/mcpCircuitBreakerIntegration.test.ts',
		'source/test/integration/mcp/mcpIdleCleanupAndAbort.test.ts',
		'source/test/integration/mcp/mcpProcessTreePosix.test.ts',
		'source/test/integration/mcp/mcpCatalogScheduler.test.ts',
		'source/test/unit/mcp/bashSecurity.test.ts',
		'source/test/unit/mcp/ideAndUserQuestion.test.ts',
		'source/test/integration/mcp/filesystem.test.ts',
		'source/test/integration/mcp/todo.test.ts',
		'source/test/integration/mcp/bashService.test.ts',
	],
	theme: [
		'source/test/unit/theme/colorScienceEngine.test.ts',
		'source/test/unit/theme/colorScienceCdcContract.test.ts',
		'source/test/unit/theme/colorScienceLifecycleResources.test.ts',
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
