/**
 * Plan Mode hard gate (P0 + P0.5)
 *
 * When planMode is on and the current session has not been explicitly approved,
 * block mutating tool side-effects. While unapproved:
 * - plan-manage (ALWAYS_ALLOW) is the only supported write path for `.snow/plan/**`
 * - filesystem-create/edit/replaceedit targeting `.snow/plan/**` are hard-blocked
 * - filesystem writes under `.trellis/tasks/**` remain allowed (Trellis coexistence)
 * - reads/search and other always-allow tools remain allowed
 * After approval, plan/trellis dirs stay in scope via isWithinPlanScope.
 */

import path from 'node:path';
import {getPlanStrictness} from '../config/projectSettings.js';
import {recordPlanEvent} from '../telemetry/otel.js';
import type {AskUserQuestionPurpose} from '../../mcp/askUserQuestion.js';
import {
	findActivePlan,
	findForeignExecutingPlans,
	findSessionPlanFiles,
	getPlanWriteOptions,
	validatePlanDocument,
	writePlanFrontmatter,
	type PlanDoc,
} from './planDocument.js';
import {
	acquirePlanOwnerLock,
	formatOwnerLockConflict,
	readPlanOwnerLock,
	releasePlanOwnerLock,
	verifyPlanOwnerLock,
} from './planOwnerLock.js';
import {
	classifyPlanOwnership,
	type PlanOwnershipClassification,
} from './planOwnership.js';
import {capturePlanWorkspaceBaseline} from './planWorkspaceBaseline.js';

type PlanGateState = {
	planApproved: boolean;
	allowedWriteFiles: Set<string>;
	activePlanPath: string | null;
};

const DEFAULT_SESSION_KEY = 'default';

const sessionGateState = new Map<string, PlanGateState>();

function resolveSessionKey(sessionId?: string | null): string {
	return sessionId && sessionId.trim().length > 0
		? sessionId
		: DEFAULT_SESSION_KEY;
}

function getState(sessionId?: string | null): PlanGateState {
	const key = resolveSessionKey(sessionId);
	let state = sessionGateState.get(key);
	if (!state) {
		state = {
			planApproved: false,
			allowedWriteFiles: new Set(),
			activePlanPath: null,
		};
		sessionGateState.set(key, state);
	}

	return state;
}

export function getPlanApproved(sessionId?: string | null): boolean {
	return getState(sessionId).planApproved;
}

export function setPlanApproved(
	sessionId: string | null | undefined,
	approved: boolean,
): void {
	getState(sessionId).planApproved = approved;
}

export function resetPlanGate(sessionId?: string | null): void {
	const key = resolveSessionKey(sessionId);
	sessionGateState.set(key, {
		planApproved: false,
		allowedWriteFiles: new Set(),
		activePlanPath: null,
	});
}

/** Test helper: wipe all session gate state. */
export function resetAllPlanGates(): void {
	sessionGateState.clear();
}

/**
 * Called when planMode toggles. Entering or leaving plan mode always starts
 * from unapproved so each activation requires a fresh confirmation.
 */
export function onPlanModeChange(
	enabled: boolean,
	sessionId?: string | null,
): void {
	// Enabled true or false → reset approval for this session
	resetPlanGate(sessionId);
	if (!enabled) {
		// Leaving plan mode: archive any completed plans left behind (best-effort)
		void import('./planArchive.js')
			.then(async m => m.sweepCompletedPlans(process.cwd()))
			.catch(() => {});
	}
}

export function normalizePathForCompare(filePath: string): string {
	return path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
}

/**
 * True when resolved path is inside a root under cwd (or a subpath).
 * Rejects path escape via `..`.
 */
function isPathInsideRoot(
	filePath: string,
	cwd: string,
	...rootSegments: string[]
): boolean {
	if (!filePath || typeof filePath !== 'string') {
		return false;
	}

	const root = path.resolve(cwd, ...rootSegments);
	const resolved = path.resolve(cwd, filePath);
	const rootNorm = normalizePathForCompare(root);
	const resolvedNorm = normalizePathForCompare(resolved);

	if (resolvedNorm === rootNorm) {
		return true;
	}

	const prefix = rootNorm.endsWith('/') ? rootNorm : `${rootNorm}/`;
	return resolvedNorm.startsWith(prefix);
}

/**
 * True when resolved path is inside `<cwd>/.snow/plan` (or a subpath).
 * Rejects path escape via `..`.
 */
export function isPlanDirPath(filePath: string, cwd: string): boolean {
	return isPathInsideRoot(filePath, cwd, '.snow', 'plan');
}

/**
 * True when resolved path is inside `<cwd>/.trellis/tasks` (or a subpath).
 * Allows Trellis planning docs while Plan Mode is unapproved (P0.5).
 */
export function isTrellisTasksDirPath(filePath: string, cwd: string): boolean {
	return isPathInsideRoot(filePath, cwd, '.trellis', 'tasks');
}

/**
 * Unapproved Plan Mode may use filesystem write tools only under
 * `.trellis/tasks/**`. Plan docs under `.snow/plan/**` must go through
 * plan-manage (ALWAYS_ALLOW), not filesystem-create/edit/replaceedit.
 */
export function isAllowedUnapprovedWritePath(
	filePath: string,
	cwd: string,
): boolean {
	return isTrellisTasksDirPath(filePath, cwd);
}

/**
 * Register the approved plan's write scope (current phase files) for a session.
 * Used after approval and when plan-manage advances/amends a phase.
 */
export function setPlanScope(
	sessionId: string | null | undefined,
	input: {planPath: string; files: string[]; cwd: string},
): void {
	const state = getState(sessionId);
	state.activePlanPath = input.planPath;
	state.allowedWriteFiles = new Set(
		input.files
			.map(f => f.replace(/\s*\(.*\)\s*$/, '').trim())
			.filter(Boolean)
			.map(f => normalizePathForCompare(path.resolve(input.cwd, f))),
	);
}

/** True when a write target is inside the approved plan's scope. */
export function isWithinPlanScope(
	filePath: string,
	cwd: string,
	sessionId?: string | undefined,
): boolean {
	if (isPlanDirPath(filePath, cwd) || isTrellisTasksDirPath(filePath, cwd)) {
		return true;
	}

	const state = getState(sessionId);
	if (state.allowedWriteFiles.size === 0) {
		// No scope registered (e.g. plan without Files lists): don't restrict.
		return true;
	}

	return state.allowedWriteFiles.has(
		normalizePathForCompare(path.resolve(cwd, filePath)),
	);
}

export function buildScopeWarningMessage(
	toolName: string,
	offending: string[],
): string {
	return (
		`[Plan Scope Warning] ${toolName} wrote outside the current phase's file list: ` +
		`${offending.join(
			', ',
		)}. If this change is intentional, call plan-manage ` +
		`with action "amend" to add these files to the plan first, so the plan stays the source of truth.`
	);
}

/** Extract the current-phase write scope (files) from a plan document. */
export function resolvePlanScopeFiles(plan: PlanDoc): string[] {
	const phase =
		plan.phases.find(p => p.index === plan.frontmatter.current_phase) ??
		plan.phases[0];
	if (phase && phase.files.length > 0) {
		return phase.files;
	}

	if (plan.affectedFiles.length > 0) {
		return plan.affectedFiles;
	}

	return [...new Set(plan.phases.flatMap(p => p.files))];
}

/**
 * Hard validation before plan approval unlocks the gate:
 * the session must have a plan file with valid structure and real file paths.
 */
export async function validatePlanBeforeApproval(
	cwd: string,
	sessionId: string | undefined | undefined,
): Promise<{ok: true; plan: PlanDoc} | {ok: false; message: string}> {
	let plan: PlanDoc | null = null;
	try {
		plan = await findActivePlan(cwd, sessionId);
	} catch {
		plan = null;
	}

	if (!plan) {
		return {
			ok: false,
			message:
				'Plan approval rejected: no plan file found under .snow/plan/. ' +
				'Create the plan document first (with frontmatter and "### Phase N" sections), then ask for approval again.',
		};
	}

	const issues = validatePlanDocument(plan, cwd);
	const errors = issues.filter(issue => issue.severity !== 'warning');
	if (errors.length > 0) {
		return {
			ok: false,
			message:
				`Plan approval rejected (${plan.filePath}): ` +
				errors.map(i => i.message).join(' ') +
				' Fix the plan file under .snow/plan/ and ask for approval again.',
		};
	}

	return {ok: true, plan};
}

/**
 * Restore in-memory gate state from disk after a session resume:
 * a plan with status=executing for this session re-approves the gate.
 */
export async function restorePlanGateFromDisk(
	cwd: string,
	sessionId: string | undefined | undefined,
): Promise<void> {
	if (getPlanApproved(sessionId)) {
		return;
	}

	try {
		const plan = await findActivePlan(cwd, sessionId);
		if (
			!plan ||
			plan.frontmatter.status !== 'executing' ||
			plan.frontmatter.session !== (sessionId || '')
		) {
			return;
		}

		const lockResult = await acquirePlanOwnerLock(cwd, {
			planPath: plan.filePath,
			sessionId: sessionId || '',
		});
		if (!lockResult.ok) {
			return;
		}

		setPlanApproved(sessionId, true);
		setPlanScope(sessionId, {
			planPath: plan.filePath,
			files: resolvePlanScopeFiles(plan),
			cwd,
		});
	} catch {
		// Best-effort restore; gate stays unapproved on failure.
	}
}

/** Collect filesystem target paths from tool args (single / batch). */
export function collectFilesystemPaths(args: any): string[] {
	if (!args || typeof args !== 'object') {
		return [];
	}

	const filePath = args.filePath ?? args.path;
	if (typeof filePath === 'string' && filePath.trim()) {
		return [filePath];
	}

	if (Array.isArray(filePath)) {
		const paths: string[] = [];
		for (const item of filePath) {
			if (typeof item === 'string' && item.trim()) {
				paths.push(item);
				continue;
			}

			if (item && typeof item === 'object') {
				const p = item.path ?? item.filePath;
				if (typeof p === 'string' && p.trim()) {
					paths.push(p);
				}
			}
		}

		return paths;
	}

	return [];
}

/**
 * Describe why filesystem write args produced no usable paths.
 * Used for plan-gate diagnostics when the model sends missing/empty filePath.
 */
export function describeEmptyFilesystemPaths(args: any): string {
	if (!args || typeof args !== 'object') {
		return 'tool args missing or not an object';
	}

	const filePath = args.filePath ?? args.path;
	if (filePath === undefined || filePath === null) {
		return 'filePath is missing';
	}

	if (typeof filePath === 'string') {
		return filePath.trim()
			? 'filePath present but not collectable'
			: 'filePath is empty string';
	}

	if (Array.isArray(filePath)) {
		return filePath.length === 0
			? 'filePath is empty array []'
			: 'filePath array has no usable path entries';
	}

	return `filePath has unsupported type (${typeof filePath})`;
}

export function buildEmptyFilePathGateMessage(
	toolName: string,
	args: any,
): string {
	const detail = describeEmptyFilesystemPaths(args);
	return (
		`Error: Plan Mode gate is active (plan not approved yet). ` +
		`Blocked tool: ${toolName}. ` +
		`Cannot verify write target because ${detail}. ` +
		`Pass a non-empty string filePath (or a non-empty batch array of {path, ...}). ` +
		`Never pass filePath: [] or "". ` +
		`While unapproved, filesystem write tools may only target .trellis/tasks/**; ` +
		`use plan-manage (create / write_body / amend) for .snow/plan/**.`
	);
}

/**
 * Conservative shell write-target extraction for post-approval scope checks.
 * Returns [] when no clear write path is found (caller should allow).
 */
export function extractShellWritePaths(command: unknown): string[] {
	if (typeof command !== 'string' || !command.trim()) {
		return [];
	}

	const cmd = command.trim();
	// Pure build/test/read-ish commands with no clear write target → no paths.
	if (
		isLikelyPureBuildOrTestCommand(cmd) &&
		!hasExplicitShellWriteSignal(cmd)
	) {
		return [];
	}

	const paths = new Set<string>();

	// Redirects: > file, >> file, 2> file, 1>>file (not comparison operators alone).
	const redirectRe =
		/(?:^|[\s;|&])\d*>{1,2}\s*(?:&?\d+)?\s*(['"]?)([^'"|&;>\n\r]+)\1/g;
	let match: RegExpExecArray | null;
	while ((match = redirectRe.exec(cmd)) !== null) {
		const candidate = (match[2] || '').trim();
		if (candidate && !/^&\d+$/.test(candidate)) {
			paths.add(stripShellPathNoise(candidate));
		}
	}

	// Destructive / write-ish commands with path args.
	const writeCommandPatterns: Array<{re: RegExp; pathGroup: number}> = [
		// Rm / del / Remove-Item
		{
			re: /(?:^|[\s;|&])(?:rm|del|erase|remove-item|ri)\b(?:\s+-[a-z]\w*)*\s+(?:--\s+)?(['"]?)([^'"|\n\r;]+)\1/gi,
			pathGroup: 2,
		},
		// Mv / move / Move-Item
		{
			re: /(?:^|[\s;|&])(?:mv|move|move-item|mi)\b(?:\s+-[a-z]\w*)*\s+(?:--\s+)?(['"]?)([^'"|\n\r;]+)\1\s+(['"]?)([^'"|\n\r;]+)\3/gi,
			pathGroup: 4, // Destination
		},
		// Cp / copy / Copy-Item
		{
			re: /(?:^|[\s;|&])(?:cp|copy|copy-item|cpi)\b(?:\s+-[a-z]\w*)*\s+(?:--\s+)?(['"]?)([^'"|\n\r;]+)\1\s+(['"]?)([^'"|\n\r;]+)\3/gi,
			pathGroup: 4, // Destination
		},
		// Sed -i file
		{
			re: /(?:^|[\s;|&])sed\b(?:\s+-[a-z\d]+)*\s+-i(?:\s*\S+)?\s+(?:'[^']*'|"[^"]*"|\S+)\s+(['"]?)([^'"|\n\r;]+)\1/gi,
			pathGroup: 2,
		},
		// Set-Content / Out-File / Add-Content path
		{
			re: /(?:^|[\s;|&])(?:set-content|out-file|add-content|sc|ac)\b(?:\s+-[a-z]+\s+\S+)*\s+(?:-path\s+)?(['"]?)([^'"|\n\r;]+)\1/gi,
			pathGroup: 2,
		},
		// New-Item -ItemType File -Path / -Name writing
		{
			re: /(?:^|[\s;|&])new-item\b(?:(?!\|).)*?(?:-path|-name)\s+(['"]?)([^'"|\n\r;]+)\1/gi,
			pathGroup: 2,
		},
		// Tee file
		{
			re: /(?:^|[\s;|&])tee\b(?:\s+-[a-z]\w*)*\s+(['"]?)([^'"|\n\r;]+)\1/gi,
			pathGroup: 2,
		},
	];

	for (const {re, pathGroup} of writeCommandPatterns) {
		re.lastIndex = 0;
		while ((match = re.exec(cmd)) !== null) {
			const candidate = (match[pathGroup] || '').trim();
			if (candidate) {
				// Some patterns capture multi-arg tails; take first token if needed.
				const first = candidate.split(/\s+/)[0] || candidate;
				if (looksLikePathToken(first)) {
					paths.add(stripShellPathNoise(first));
				}
			}
		}
	}

	return [...paths].filter(Boolean);
}

function stripShellPathNoise(value: string): string {
	return value.replace(/^['"]+|['"]+$/g, '').trim();
}

function looksLikePathToken(value: string): boolean {
	if (!value || value.startsWith('-')) {
		return false;
	}

	// Avoid treating pure flags / numbers / pure shell tokens as paths.
	if (/^(&?\d+|true|false|null)$/i.test(value)) {
		return false;
	}

	return true;
}

function hasExplicitShellWriteSignal(command: string): boolean {
	return (
		/(?:^|[\s;|&])\d*>{1,2}\s*\S+/.test(command) ||
		/\b(?:rm|del|erase|mv|move|cp|copy|tee|sed)\b/i.test(command) ||
		/\b(?:remove-item|move-item|copy-item|set-content|out-file|add-content|new-item)\b/i.test(
			command,
		)
	);
}

/**
 * Whitelist common pure build/test/read commands so they are not blocked when
 * no write path can be extracted.
 */
export function isLikelyPureBuildOrTestCommand(command: string): boolean {
	const cmd = command.trim();
	if (!cmd) {
		return false;
	}

	// Reject early if explicit write signals dominate (redirects etc. checked by caller).
	const purePatterns = [
		/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|lint|typecheck|check|ci|compile|tsc|ava|jest|vitest|mocha)\b/i,
		/^(?:npx|pnpm\s+dlx|yarn\s+dlx)\s+(?:tsc|ava|jest|vitest|mocha|eslint|prettier)\b/i,
		/^(?:node|tsx|ts-node)\s+[^\n|>]+/i,
		/^(?:dotnet|go|cargo|make|cmake|gradle|mvn)\s+(?:build|test|check|run|compile)\b/i,
		/^(?:python|python3|py)\s+-m\s+(?:pytest|unittest)\b/i,
		/^(?:pytest|unittest)\b/i,
		/^git\s+(?:status|diff|log|show|branch|rev-parse)\b/i,
		/^(?:ls|dir|cat|type|get-content|get-childitem|echo|write-output|pwd|cd)\b/i,
	];
	return purePatterns.some(re => re.test(cmd));
}

const ALWAYS_ALLOW_EXACT = new Set([
	'askuser-ask_question',
	'filesystem-read',
	'ace-search',
	'codebase-search',
	'ide-get_diagnostics',
	'todo-manage',
	'todo-ultra',
	'plan-manage',
	'notebook-manage',
	'skill-execute',
	'websearch-search',
	'websearch-fetch',
	'snow-docs-list',
	'snow-docs-search',
	'snow-docs-get',
	'tool_search',
	'tool-search',
]);

const ALWAYS_ALLOW_PREFIXES = ['ace-', 'websearch-', 'snow-docs-', 'codebase-'];

const ALLOWED_SUBAGENTS = new Set([
	'subagent-agent_explore',
	'subagent-agent_plan',
	'subagent-agent_analyze',
	'subagent-agent_qa',
]);

const BLOCKED_SUBAGENTS = new Set([
	'subagent-agent_general',
	'subagent-agent_debug',
]);

const FILESYSTEM_WRITE_TOOLS = new Set([
	'filesystem-create',
	'filesystem-edit',
	'filesystem-replaceedit',
]);

export function buildPlanGateBlockMessage(toolName: string): string {
	return (
		`Error: Plan Mode gate is active (plan not approved yet). ` +
		`Blocked tool: ${toolName}. ` +
		`While unapproved you may only read/search, use plan-manage for .snow/plan/**, ` +
		`and use filesystem write tools only under .trellis/tasks/**. ` +
		`Create or update the plan via plan-manage, then call askuser-ask_question and get explicit approval ` +
		`(e.g. "Yes - Execute the entire plan") before modifying code or running commands. ` +
		`While unapproved, terminal-execute is hard-blocked — do not attempt IDE CLI open or shell commands.`
	);
}

/**
 * Dedicated message when unapproved Plan Mode blocks filesystem writes to
 * `.snow/plan/**`. plan-manage is the only supported persist path for plans.
 */
export function buildPlanFilesystemWriteBlockMessage(toolName: string): string {
	return (
		`Error: Plan Mode gate is active (plan not approved yet). ` +
		`Blocked tool: ${toolName}. ` +
		`While unapproved, filesystem-create / filesystem-edit / filesystem-replaceedit ` +
		`cannot write under .snow/plan/**. ` +
		`Use plan-manage with action create / write_body / amend to persist plan documents. ` +
		`Do not use filesystem write tools for plan files.`
	);
}

function isAlwaysAllowTool(toolName: string): boolean {
	if (ALWAYS_ALLOW_EXACT.has(toolName)) {
		return true;
	}

	return ALWAYS_ALLOW_PREFIXES.some(prefix => toolName.startsWith(prefix));
}

function isTerminalLikeTool(toolName: string): boolean {
	if (toolName === 'terminal-execute' || toolName === 'bash-execute') {
		return true;
	}

	// Avoid false positives on skill-execute / todo etc. (already allowlisted).
	if (toolName.includes('terminal') || toolName.includes('bash')) {
		return true;
	}

	// Generic "*-execute" shell-ish names, but not skill-execute / already allowed.
	if (
		toolName.endsWith('-execute') &&
		toolName !== 'skill-execute' &&
		!toolName.startsWith('skill-')
	) {
		return true;
	}

	return false;
}

export function classifyPlanGateDecision(
	toolName: string,
	args: any,
	cwd: string,
): 'allow' | 'block' {
	if (isAlwaysAllowTool(toolName)) {
		return 'allow';
	}

	if (toolName.startsWith('subagent-')) {
		if (ALLOWED_SUBAGENTS.has(toolName)) {
			return 'allow';
		}

		if (BLOCKED_SUBAGENTS.has(toolName)) {
			return 'block';
		}

		// Unknown custom agents: block when unapproved (safer default for writers).
		return 'block';
	}

	// Team tools can spawn writers / mutate shared work; block while unapproved.
	if (toolName.startsWith('team-')) {
		return 'block';
	}

	if (isTerminalLikeTool(toolName)) {
		return 'block';
	}

	if (FILESYSTEM_WRITE_TOOLS.has(toolName)) {
		const paths = collectFilesystemPaths(args);
		if (paths.length === 0) {
			// No path → cannot verify allowed trellis roots; block.
			return 'block';
		}

		// Unapproved: only .trellis/tasks/** for filesystem write tools.
		// .snow/plan/** must go through plan-manage (ALWAYS_ALLOW).
		const allAllowed = paths.every(p => isAllowedUnapprovedWritePath(p, cwd));
		return allAllowed ? 'allow' : 'block';
	}

	// Obvious mutating names (external MCP), excluding known allowlist.
	const lower = toolName.toLowerCase();
	if (
		lower.includes('write') ||
		lower.includes('delete') ||
		lower.includes('remove') ||
		lower.includes('unlink')
	) {
		return 'block';
	}

	// Default allow for unknown read-ish MCP tools (P0 usability).
	return 'allow';
}

function normalizeAnswerText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function flattenSelected(selected: string | string[]): string[] {
	if (Array.isArray(selected)) {
		return selected.filter(s => typeof s === 'string');
	}

	return typeof selected === 'string' ? [selected] : [];
}

/**
 * Detect explicit plan-execution approval from askuser answers.
 * Prefers full option text; uses question context to reduce false positives.
 */
export function isPlanApprovalAnswer(input: {
	question?: string;
	selected: string | string[];
	customInput?: string;
	purpose?: AskUserQuestionPurpose;
}): boolean {
	if (input.purpose === 'clarification') {
		return false;
	}

	const options = flattenSelected(input.selected).map(normalizeAnswerText);
	if (options.length === 0) {
		return false;
	}

	const question = normalizeAnswerText(input.question || '');
	// Empty/missing question must NOT count as plan confirmation (avoids FP unlock).
	const looksLikePlanConfirm =
		question.length > 0 &&
		(question.includes('plan') ||
			question.includes('计划') ||
			question.includes('implementation') ||
			question.includes('execute') ||
			question.includes('执行'));
	const looksLikeResumeAnswer = options.some(
		opt =>
			opt.includes('continue') ||
			opt.includes('resume') ||
			opt.includes('继续') ||
			opt.includes('接着'),
	);
	if (input.purpose === 'plan_resume' && !looksLikeResumeAnswer) {
		return false;
	}

	for (const opt of options) {
		// Explicit reject / review / modify
		if (
			opt.includes('review') ||
			opt.includes('modify') ||
			opt.includes('修改') ||
			opt.includes('先看') ||
			opt.includes('先让我') ||
			opt.includes('不要') ||
			opt.includes('cancel') ||
			opt.includes('reject')
		) {
			return false;
		}

		// Full / explicit approval phrases (safe without question context)
		if (
			opt.includes('execute the entire plan') ||
			opt.includes('execute entire plan') ||
			opt.includes('yes - execute') ||
			opt.includes('continue the plan') ||
			opt.includes('continue this plan') ||
			opt.includes('resume plan') ||
			opt.includes('执行整个计划') ||
			opt.includes('批准并执行') ||
			opt.includes('批准计划') ||
			opt.includes('开始执行') ||
			opt.includes('继续执行') ||
			opt.includes('继续该计划') ||
			opt.includes('继续此计划') ||
			opt.includes('继续计划')
		) {
			return true;
		}

		// Short Chinese approve tokens only when question is clearly plan-related
		if (looksLikePlanConfirm && (opt === '执行' || opt === '批准')) {
			return true;
		}

		// "Yes ..." style approvals
		if (
			/^yes\b/.test(opt) &&
			(opt.includes('execute') || looksLikePlanConfirm)
		) {
			return true;
		}

		// Chinese short yes when question is clearly plan confirmation
		if (
			looksLikePlanConfirm &&
			(opt === '是' || opt === '好的' || opt === '同意' || opt === '可以')
		) {
			return true;
		}
	}

	// Custom input alone is not enough unless clearly affirmative execute intent
	if (input.customInput) {
		const custom = normalizeAnswerText(input.customInput);
		if (
			custom.includes('execute the entire plan') ||
			custom.includes('执行整个计划') ||
			custom.includes('批准并执行')
		) {
			return true;
		}
	}

	return false;
}

export function isPlanRejectOrModifyAnswer(input: {
	selected: string | string[];
}): boolean {
	const options = flattenSelected(input.selected).map(normalizeAnswerText);
	return options.some(
		opt =>
			opt.includes('review') ||
			opt.includes('modify') ||
			opt.includes('修改') ||
			opt.includes('先看') ||
			opt.includes('先让我'),
	);
}

export async function evaluatePlanGate(input: {
	planMode: boolean;
	sessionId?: string | undefined;
	toolName: string;
	args: any;
	cwd: string;
}): Promise<{allow: boolean; message?: string; warning?: string}> {
	if (!input.planMode) {
		return {allow: true};
	}

	if (getPlanApproved(input.sessionId)) {
		const state = getState(input.sessionId);
		if (state.activePlanPath) {
			const owner = await verifyPlanOwnerLock(input.cwd, {
				planPath: state.activePlanPath,
				sessionId: input.sessionId || '',
			});
			if (!owner.ok) {
				resetPlanGate(input.sessionId);
				return {allow: false, message: `Error: ${owner.message}`};
			}
		}

		// Approved: enforce plan scope on filesystem writes and obvious shell writes.
		let strictness: 'strict' | 'soft' | 'off' = 'soft';
		try {
			strictness = getPlanStrictness();
		} catch {
			strictness = 'soft';
		}

		if (strictness === 'off') {
			return {allow: true};
		}

		let paths: string[] = [];
		if (FILESYSTEM_WRITE_TOOLS.has(input.toolName)) {
			paths = collectFilesystemPaths(input.args);
		} else if (isTerminalLikeTool(input.toolName)) {
			// Conservative: only check when we can extract clear write targets.
			// Pure build/test commands with no extracted paths are allowed.
			const command =
				typeof input.args?.command === 'string'
					? input.args.command
					: typeof input.args?.cmd === 'string'
					? input.args.cmd
					: '';
			paths = extractShellWritePaths(command);
			if (paths.length === 0) {
				return {allow: true};
			}
		} else {
			return {allow: true};
		}

		const offending = paths.filter(
			p => !isWithinPlanScope(p, input.cwd, input.sessionId),
		);
		if (offending.length === 0) {
			return {allow: true};
		}

		if (strictness === 'strict') {
			recordPlanEvent({
				event: 'gate_block',
				sessionId: input.sessionId || undefined,
				toolName: input.toolName,
				strictness,
				reason: 'strict-scope',
			});
			return {
				allow: false,
				message:
					`Error: Plan Mode strict scope is active. ` +
					`These paths are outside the current phase's file list: ${offending.join(
						', ',
					)}. ` +
					`Call plan-manage with action "amend" to add them to the plan, then retry.`,
			};
		}

		recordPlanEvent({
			event: 'scope_warning',
			sessionId: input.sessionId || undefined,
			toolName: input.toolName,
			strictness,
		});
		return {
			allow: true,
			warning: buildScopeWarningMessage(input.toolName, offending),
		};
	}

	// Always allow the approval tool itself
	if (input.toolName === 'askuser-ask_question') {
		return {allow: true};
	}

	const decision = classifyPlanGateDecision(
		input.toolName,
		input.args,
		input.cwd,
	);

	if (decision === 'allow') {
		return {allow: true};
	}

	// Filesystem writes with missing/empty paths get an explicit diagnostic
	// so the model does not only see the generic unapproved-gate message.
	// Empty-path diagnosis takes priority over plan-fs-write messaging.
	if (FILESYSTEM_WRITE_TOOLS.has(input.toolName)) {
		const paths = collectFilesystemPaths(input.args);
		if (paths.length === 0) {
			recordPlanEvent({
				event: 'gate_block',
				sessionId: input.sessionId || undefined,
				toolName: input.toolName,
				reason: 'empty-filepath',
			});
			return {
				allow: false,
				message: buildEmptyFilePathGateMessage(input.toolName, input.args),
			};
		}

		// Prefer a dedicated guidance message when the write targets .snow/plan/**
		// so models are steered to plan-manage instead of freeform FS writes.
		if (paths.some(p => isPlanDirPath(p, input.cwd))) {
			recordPlanEvent({
				event: 'gate_block',
				sessionId: input.sessionId || undefined,
				toolName: input.toolName,
				reason: 'plan-fs-write',
			});
			return {
				allow: false,
				message: buildPlanFilesystemWriteBlockMessage(input.toolName),
			};
		}
	}

	recordPlanEvent({
		event: 'gate_block',
		sessionId: input.sessionId || undefined,
		toolName: input.toolName,
		reason: 'unapproved',
	});
	return {
		allow: false,
		message: buildPlanGateBlockMessage(input.toolName),
	};
}

/**
 * Classify ownership of a plan document against the current session + lock.
 * Prefer this over raw findForeignExecutingPlans when deciding hard/soft/live.
 */
export async function classifyPlanDocOwnership(
	cwd: string,
	doc: PlanDoc,
	sessionId?: string | undefined,
): Promise<PlanOwnershipClassification> {
	const lock = await readPlanOwnerLock(cwd);
	return classifyPlanOwnership({
		cwd,
		sessionId,
		plan: {
			filePath: doc.filePath,
			frontmatter: {
				status: doc.frontmatter.status,
				session: doc.frontmatter.session,
			},
		},
		lock,
	});
}

/**
 * Executing plans that block approving a *new* plan for this session.
 * Only foreign_live / foreign_soft_stale contenders block hard.
 * foreign_hard_stale / untagged_recoverable / mine_* are recoverable and
 * surface as soft cleanup hints instead of hard blocks.
 */
export async function findBlockingForeignPlans(
	cwd: string,
	sessionId?: string | undefined,
	exceptPlanPath?: string | undefined,
): Promise<{
	blocking: Array<{doc: PlanDoc; ownership: PlanOwnershipClassification}>;
	recoverable: Array<{doc: PlanDoc; ownership: PlanOwnershipClassification}>;
}> {
	const foreign = await findForeignExecutingPlans(cwd, sessionId);
	const except = exceptPlanPath ? path.resolve(exceptPlanPath) : null;
	const blocking: Array<{
		doc: PlanDoc;
		ownership: PlanOwnershipClassification;
	}> = [];
	const recoverable: Array<{
		doc: PlanDoc;
		ownership: PlanOwnershipClassification;
	}> = [];

	for (const doc of foreign) {
		if (except && path.resolve(doc.filePath) === except) {
			continue;
		}

		const ownership = await classifyPlanDocOwnership(cwd, doc, sessionId);
		if (
			ownership.kind === 'foreign_live' ||
			ownership.kind === 'foreign_soft_stale'
		) {
			blocking.push({doc, ownership});
		} else if (
			ownership.kind === 'foreign_hard_stale' ||
			ownership.kind === 'untagged_recoverable' ||
			ownership.kind === 'mine_recoverable'
		) {
			recoverable.push({doc, ownership});
		}
	}

	return {blocking, recoverable};
}

function formatOwnershipCandidateLine(
	doc: PlanDoc,
	ownership: PlanOwnershipClassification,
): string {
	return `- ${doc.filePath} (session=${
		doc.frontmatter.session || 'none'
	}, ownership=${ownership.kind})`;
}

/**
 * After askuser returns, update plan approval state when planMode is on.
 * Approval only takes effect when the plan document passes hard validation;
 * on failure the returned error should be surfaced to the model.
 *
 * Continue/approve ownership rules (phase 3):
 * - unique recoverable (mine_recoverable / untagged_recoverable /
 *   foreign_hard_stale) → Continue must go through plan-manage adopt without force
 * - foreign_live / foreign_soft_stale → Continue without force is forbidden;
 *   approving a *new* plan hard-blocks while foreign_live (or soft-stale) exists
 */
export async function maybeApprovePlanFromAskUser(input: {
	planMode: boolean;
	sessionId?: string | undefined;
	cwd?: string;
	question?: string;
	selected: string | string[];
	customInput?: string;
	purpose?: AskUserQuestionPurpose;
}): Promise<{approved: boolean; error?: string}> {
	if (!input.planMode) {
		return {approved: false};
	}

	if (
		isPlanApprovalAnswer({
			question: input.question,
			selected: input.selected,
			customInput: input.customInput,
			purpose: input.purpose,
		})
	) {
		const cwd = input.cwd || process.cwd();
		const selectedText = Array.isArray(input.selected)
			? input.selected.join(' ')
			: String(input.selected || '');
		const customText = String(input.customInput || '');
		const combined = `${input.question || ''} ${selectedText} ${customText}`;
		const isContinueIntent =
			/continue|resume|继续|接着|adopt/i.test(combined) ||
			/continue\s*:/i.test(combined);

		const validation = await validatePlanBeforeApproval(cwd, input.sessionId);

		// Continue path: never silently rebind foreign ownership from askuser.
		// Always route through plan-manage adopt so force/reason can be enforced.
		if (!validation.ok && isContinueIntent) {
			const pathMatch =
				/continue\s*:\s*([^\n|]+)/i.exec(combined) ||
				/(?:\.snow[\\/]plan[\\/][^\s|]+)/i.exec(combined);
			const explicitPath = pathMatch?.[1]?.trim() || pathMatch?.[0]?.trim();
			const executing = (await findSessionPlanFiles(cwd, null))
				.filter(d => d.frontmatter.status === 'executing')
				.sort((a, b) => b.mtimeMs - a.mtimeMs);

			const classified = await Promise.all(
				executing.map(async doc => ({
					doc,
					ownership: await classifyPlanDocOwnership(cwd, doc, input.sessionId),
				})),
			);

			const resolveTarget = ():
				| {doc: PlanDoc; ownership: PlanOwnershipClassification}
				| undefined => {
				if (explicitPath) {
					const resolved = path.resolve(cwd, explicitPath);
					return classified.find(
						c =>
							path.resolve(c.doc.filePath) === resolved ||
							path
								.normalize(c.doc.filePath)
								.toLowerCase()
								.endsWith(path.normalize(explicitPath).toLowerCase()),
					);
				}

				return classified.length === 1 ? classified[0] : undefined;
			};

			const target = resolveTarget();

			if (classified.length > 1 && !target) {
				setPlanApproved(input.sessionId, false);
				return {
					approved: false,
					error:
						`Continue requires explicit plan adoption so ownership can be checked safely. ` +
						`Call plan-manage {action:"adopt", plan_path:"..."}. Candidates:\n` +
						classified
							.map(c => formatOwnershipCandidateLine(c.doc, c.ownership))
							.join('\n'),
				};
			}

			if (target) {
				setPlanApproved(input.sessionId, false);
				const {doc, ownership} = target;
				if (
					ownership.kind === 'foreign_live' ||
					ownership.kind === 'foreign_soft_stale'
				) {
					return {
						approved: false,
						error:
							`Continue refused: ownership=${ownership.kind} for ${doc.filePath}. ` +
							`${ownership.summary} ` +
							`A live/soft-stale foreign owner cannot be taken over by a generic Continue answer. ` +
							`Call plan-manage {action:"adopt", plan_path:"${doc.filePath}", force:true, reason:"..."} ` +
							`only if intentional takeover is required.`,
					};
				}

				if (ownership.canAdoptWithoutForce) {
					return {
						approved: false,
						error:
							`Continue requires plan-manage {action:"adopt", plan_path:"${doc.filePath}"} ` +
							`(ownership=${ownership.kind}; no force needed). ` +
							`Generic Continue cannot rebind ownership by itself.`,
					};
				}

				return {
					approved: false,
					error:
						`Continue requires plan-manage {action:"adopt", plan_path:"${doc.filePath}"}. ` +
						`ownership=${ownership.kind}. ${ownership.summary}`,
				};
			}

			if (executing.length === 0) {
				setPlanApproved(input.sessionId, false);
				return {
					approved: false,
					error:
						'Continue refused: no executing plan found to resume. ' +
						'Create/approve a plan first, or pass an explicit plan path via plan-manage adopt.',
				};
			}
		}

		if (!validation.ok) {
			setPlanApproved(input.sessionId, false);
			return {approved: false, error: validation.message};
		}

		// Approving a new/session plan: hard-block only live/soft-stale foreign owners.
		const {blocking, recoverable} = await findBlockingForeignPlans(
			cwd,
			input.sessionId,
			validation.plan.filePath,
		);
		if (blocking.length > 0) {
			setPlanApproved(input.sessionId, false);
			const hasLive = blocking.some(b => b.ownership.kind === 'foreign_live');
			const hasSoft = blocking.some(
				b => b.ownership.kind === 'foreign_soft_stale',
			);
			const label = hasLive
				? 'foreign_live'
				: hasSoft
				? 'foreign_soft_stale'
				: 'foreign';
			return {
				approved: false,
				error:
					`Cannot approve: another session already has a ${label} executing plan:\n` +
					blocking
						.map(b => formatOwnershipCandidateLine(b.doc, b.ownership))
						.join('\n') +
					`\nFinish/abandon that plan, or force takeover via plan-manage ` +
					`{action:"adopt", plan_path:"...", force:true, reason:"..."} first.` +
					(hasSoft
						? ' Soft-stale foreign owners still require force+reason (never silent).'
						: ''),
			};
		}

		const lockResult = await acquirePlanOwnerLock(cwd, {
			planPath: validation.plan.filePath,
			sessionId: input.sessionId || '',
		});
		if (!lockResult.ok) {
			setPlanApproved(input.sessionId, false);
			return {
				approved: false,
				error: formatOwnerLockConflict(lockResult.conflict),
			};
		}

		try {
			const baseline = await capturePlanWorkspaceBaseline(cwd);
			await writePlanFrontmatter(
				validation.plan.filePath,
				{
					status: 'executing',
					current_phase: Math.max(1, validation.plan.frontmatter.current_phase),
					approved_at: new Date().toISOString(),
					session: input.sessionId ?? validation.plan.frontmatter.session,
					phase_started_at: new Date().toISOString(),
					phase_baseline: baseline.available ? baseline.baseline : undefined,
				},
				getPlanWriteOptions(validation.plan),
			);
		} catch (error) {
			await releasePlanOwnerLock(cwd, {
				planPath: validation.plan.filePath,
				sessionId: input.sessionId || '',
			});
			setPlanApproved(input.sessionId, false);
			return {
				approved: false,
				error: `Plan approval persistence failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}

		setPlanApproved(input.sessionId, true);
		setPlanScope(input.sessionId, {
			planPath: validation.plan.filePath,
			files: resolvePlanScopeFiles({
				...validation.plan,
				frontmatter: {
					...validation.plan.frontmatter,
					current_phase: Math.max(1, validation.plan.frontmatter.current_phase),
				},
			}),
			cwd,
		});
		const cleanupHint =
			recoverable.length > 0
				? ` Note: recoverable leftover plans remain (cleanup optional):\n${recoverable
						.map(r => formatOwnershipCandidateLine(r.doc, r.ownership))
						.join('\n')}`
				: '';
		recordPlanEvent({
			event: 'approve',
			sessionId: input.sessionId || undefined,
			planPath: validation.plan.filePath,
			status: 'executing',
			phase: Math.max(1, validation.plan.frontmatter.current_phase),
			reason: 'askuser',
		});
		// CleanupHint is not an error; approval still succeeds.
		void cleanupHint;
		return {approved: true};
	}

	if (
		input.purpose !== 'clarification' &&
		isPlanRejectOrModifyAnswer({selected: input.selected})
	) {
		setPlanApproved(input.sessionId, false);
	}

	return {approved: false};
}
