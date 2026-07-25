/**
 * Plan Mode hard gate (P0 + P0.5)
 *
 * When planMode is on and the current session has not been explicitly approved,
 * block mutating tool side-effects. Planning tools and writes under:
 * - .snow/plan/**
 * - .trellis/tasks/** (Trellis planning artifacts; P0.5 coexistence)
 * remain allowed.
 */

import path from 'node:path';
import {getPlanStrictness} from '../config/projectSettings.js';
import {
	findActivePlan,
	validatePlanDocument,
	writePlanFrontmatter,
	type PlanDoc,
} from './planDocument.js';

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
	// enabled true or false → reset approval for this session
	resetPlanGate(sessionId);
	if (!enabled) {
		// Leaving plan mode: archive any completed plans left behind (best-effort)
		void import('./planArchive.js')
			.then(m => m.sweepCompletedPlans(process.cwd()))
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
 * Unapproved Plan Mode may write only to planning artifact roots.
 */
export function isAllowedUnapprovedWritePath(
	filePath: string,
	cwd: string,
): boolean {
	return isPlanDirPath(filePath, cwd) || isTrellisTasksDirPath(filePath, cwd);
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
	sessionId?: string | null,
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
	sessionId: string | null | undefined,
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
	if (issues.length > 0) {
		return {
			ok: false,
			message:
				`Plan approval rejected (${plan.filePath}): ` +
				issues.map(i => i.message).join(' ') +
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
	sessionId: string | null | undefined,
): Promise<void> {
	if (getPlanApproved(sessionId)) {
		return;
	}
	try {
		const plan = await findActivePlan(cwd, sessionId);
		if (plan && plan.frontmatter.status === 'executing') {
			setPlanApproved(sessionId, true);
			setPlanScope(sessionId, {
				planPath: plan.filePath,
				files: resolvePlanScopeFiles(plan),
				cwd,
			});
		}
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
		`You may only read/search and write files under .snow/plan/** or .trellis/tasks/**. ` +
		`Create or update the plan, then call askuser-ask_question and get explicit approval ` +
		`(e.g. "Yes - Execute the entire plan") before modifying code or running commands.`
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
			// No path → cannot verify allowed planning roots; block.
			return 'block';
		}
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
}): boolean {
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
			opt.includes('执行整个计划') ||
			opt.includes('批准并执行') ||
			opt.includes('批准计划') ||
			opt.includes('开始执行') ||
			opt.includes('继续执行')
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

export function evaluatePlanGate(input: {
	planMode: boolean;
	sessionId?: string | null;
	toolName: string;
	args: any;
	cwd: string;
}): {allow: boolean; message?: string; warning?: string} {
	if (!input.planMode) {
		return {allow: true};
	}

	if (getPlanApproved(input.sessionId)) {
		// Approved: enforce plan scope on filesystem writes per strictness.
		if (!FILESYSTEM_WRITE_TOOLS.has(input.toolName)) {
			return {allow: true};
		}
		let strictness: 'strict' | 'soft' | 'off' = 'soft';
		try {
			strictness = getPlanStrictness();
		} catch {
			strictness = 'soft';
		}
		if (strictness === 'off') {
			return {allow: true};
		}
		const paths = collectFilesystemPaths(input.args);
		const offending = paths.filter(
			p => !isWithinPlanScope(p, input.cwd, input.sessionId),
		);
		if (offending.length === 0) {
			return {allow: true};
		}
		if (strictness === 'strict') {
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

	return {
		allow: false,
		message: buildPlanGateBlockMessage(input.toolName),
	};
}

/**
 * After askuser returns, update plan approval state when planMode is on.
 * Approval only takes effect when the plan document passes hard validation;
 * on failure the returned error should be surfaced to the model.
 */
export async function maybeApprovePlanFromAskUser(input: {
	planMode: boolean;
	sessionId?: string | null;
	cwd?: string;
	question?: string;
	selected: string | string[];
	customInput?: string;
}): Promise<{approved: boolean; error?: string}> {
	if (!input.planMode) {
		return {approved: false};
	}

	if (
		isPlanApprovalAnswer({
			question: input.question,
			selected: input.selected,
			customInput: input.customInput,
		})
	) {
		const cwd = input.cwd || process.cwd();
		const validation = await validatePlanBeforeApproval(cwd, input.sessionId);
		if (!validation.ok) {
			setPlanApproved(input.sessionId, false);
			return {approved: false, error: validation.message};
		}

		setPlanApproved(input.sessionId, true);
		try {
			await writePlanFrontmatter(validation.plan.filePath, {
				status: 'executing',
				current_phase: Math.max(1, validation.plan.frontmatter.current_phase),
				approved_at: new Date().toISOString(),
				session: input.sessionId ?? validation.plan.frontmatter.session,
			});
		} catch {
			// Frontmatter persistence is best-effort; approval still holds.
		}
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
		return {approved: true};
	}

	if (isPlanRejectOrModifyAnswer({selected: input.selected})) {
		setPlanApproved(input.sessionId, false);
	}
	return {approved: false};
}
