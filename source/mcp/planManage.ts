import {
	type Tool,
	type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	findActivePlan,
	findSessionPlanFiles,
	parsePlanDocument,
	setStepChecked,
	writePlanFrontmatter,
	type PlanComplexity,
	type PlanDoc,
	type PlanPhase,
} from '../utils/execution/planDocument.js';
import {
	setPlanScope,
	resolvePlanScopeFiles,
	setPlanApproved,
	resetPlanGate,
} from '../utils/execution/planModeGate.js';
import {archivePlan} from '../utils/execution/planArchive.js';
import {runAcceptance} from '../utils/execution/planAcceptance.js';
import {
	buildPlanMarkdown,
	slugifyPlanTitle,
} from '../utils/execution/planTemplate.js';
import {getPlanDateDir} from '../utils/execution/planPaths.js';
import {getPlanAcceptanceSettings} from '../utils/config/projectSettings.js';
import {sessionManager} from '../utils/session/sessionManager.js';

const PLAN_ACTIONS = [
	'check_step',
	'complete_phase',
	'amend',
	'complete',
	'get',
	'status',
	'list',
	'uncheck_step',
	'abandon',
	'adopt',
	'create',
] as const;

type PlanAction = (typeof PLAN_ACTIONS)[number];

/**
 * Plan Mode 执行期管理工具：勾选步骤、阶段验收推进、修订计划、完成归档。
 * 参考 todo-manage / notebook-manage 的单工具 action 枚举模式。
 */
export const planManageTools: Tool[] = [
	{
		name: 'plan-manage',
		description: `Manage plans under .snow/plan/ during Plan Mode (active plans may live in date subdirs YYYY-MM-DD/). Required field "action":

- create: Create a new draft plan from a template. Required "title". Optional "slug", "complexity" (simple|medium|complex), "context", "session".
- get: Summarize the active plan for this session (path, status, phase, step progress, next step, files).
- status: Compact progress line for the active plan.
- list: List all active plans (all sessions) under .snow/plan date dirs + legacy top-level.
- check_step: Mark a step done. Required "step_index" (1-based). Optional "phase_index" (defaults current).
- uncheck_step: Unmark a step. Required "step_index". Optional "phase_index".
- complete_phase: Run acceptance for the current phase; advance current_phase. All steps must be checked first.
- amend: Update the plan when scope changes. Optional "phase_index", "add_files", "add_steps", required "reason".
- complete: Final acceptance after ALL phases; archives the plan to .snow/plan/archive/YYYY-MM-DD/.
- abandon: Abandon active plan. Required "reason". Sets status abandoned, clears gate, archives.
- adopt: Rebind an executing plan to this session and restore the gate. Optional "plan_path"; else latest executing plan any session.

The plan file is the source of truth — keep it in sync with reality via these actions.`,
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: [...PLAN_ACTIONS],
					description: 'Which plan operation to run.',
				},
				step_index: {
					type: 'number',
					description:
						'For action=check_step/uncheck_step: 1-based step index within the phase.',
				},
				phase_index: {
					type: 'number',
					description:
						'Optional 1-based phase index; defaults to the current phase.',
				},
				add_files: {
					type: 'array',
					items: {type: 'string'},
					description:
						"For action=amend: file paths to add to the phase's Files list.",
				},
				add_steps: {
					type: 'array',
					items: {type: 'string'},
					description: 'For action=amend: steps to append to the phase.',
				},
				reason: {
					type: 'string',
					description:
						'For action=amend/abandon: why the plan changed or was abandoned.',
				},
				title: {
					type: 'string',
					description: 'For action=create: plan title (required).',
				},
				slug: {
					type: 'string',
					description: 'For action=create: optional file slug (kebab-case).',
				},
				complexity: {
					type: 'string',
					enum: ['simple', 'medium', 'complex'],
					description: 'For action=create: plan complexity tier.',
				},
				context: {
					type: 'string',
					description: 'For action=create: optional context body text.',
				},
				session: {
					type: 'string',
					description:
						'For action=create: optional session id (defaults to current).',
				},
				plan_path: {
					type: 'string',
					description:
						'For action=adopt: optional absolute/relative plan path.',
				},
			},
			required: ['action'],
		},
	},
];

function textResult(text: string, isError = false): CallToolResult {
	return {content: [{type: 'text', text}], ...(isError ? {isError: true} : {})};
}

function getSessionId(): string | null {
	return sessionManager.getCurrentSession()?.id ?? null;
}

function currentPhaseOf(doc: PlanDoc): PlanPhase | undefined {
	const idx = Math.max(1, doc.frontmatter.current_phase);
	return doc.phases.find(p => p.index === idx) ?? doc.phases[0];
}

function resolvePhaseIndex(doc: PlanDoc, args: any): number {
	return Number.isInteger(Number(args?.phase_index))
		? Number(args.phase_index)
		: Math.max(1, doc.frontmatter.current_phase || 1);
}

function summarizePlan(doc: PlanDoc): string {
	const phase = currentPhaseOf(doc);
	const totalSteps = doc.phases.reduce((n, p) => n + p.steps.length, 0);
	const checkedSteps = doc.phases.reduce(
		(n, p) => n + p.steps.filter(s => s.checked).length,
		0,
	);
	const phaseChecked = phase?.steps.filter(s => s.checked).length ?? 0;
	const phaseTotal = phase?.steps.length ?? 0;
	const next = phase?.steps.find(s => !s.checked);
	const files = phase?.files?.length
		? phase.files.join(', ')
		: doc.affectedFiles.join(', ') || '(none)';
	const title =
		doc.frontmatter.title || doc.title || path.basename(doc.filePath);

	return [
		`Plan: ${title}`,
		`Path: ${doc.filePath}`,
		`Status: ${doc.frontmatter.status}`,
		`Session: ${doc.frontmatter.session || '(none)'}`,
		`Complexity: ${doc.frontmatter.complexity || '(unset)'}`,
		`Phase: ${doc.frontmatter.current_phase}/${doc.phases.length}${
			phase ? ` (${phase.title})` : ''
		}`,
		`Steps: ${checkedSteps}/${totalSteps} overall; phase ${phaseChecked}/${phaseTotal}`,
		`Next step: ${next ? next.text : '(all steps in current phase checked)'}`,
		`Files (scope): ${files}`,
	].join('\n');
}

function statusLine(doc: PlanDoc): string {
	const phase = currentPhaseOf(doc);
	const phaseChecked = phase?.steps.filter(s => s.checked).length ?? 0;
	const phaseTotal = phase?.steps.length ?? 0;
	const next = phase?.steps.find(s => !s.checked);
	const title =
		doc.frontmatter.title || doc.title || path.basename(doc.filePath);
	return `status=${doc.frontmatter.status} phase=${
		doc.frontmatter.current_phase
	}/${doc.phases.length} steps=${phaseChecked}/${phaseTotal} next="${
		next?.text ?? 'done'
	}" title="${title}" path=${doc.filePath}`;
}

// Re-export for tests that imported runAcceptance from planManage.
export {runAcceptance} from '../utils/execution/planAcceptance.js';

async function requireActivePlan(
	cwd: string,
): Promise<{doc: PlanDoc} | {error: CallToolResult}> {
	const doc = await findActivePlan(cwd, getSessionId());
	if (!doc) {
		return {
			error: textResult(
				'Error: no active plan found under .snow/plan/ (including YYYY-MM-DD/ date subdirs). Create and get the plan approved first.',
				true,
			),
		};
	}
	return {doc};
}

async function handleCheckStep(
	doc: PlanDoc,
	args: any,
	checked: boolean,
): Promise<CallToolResult> {
	const actionName = checked ? 'check_step' : 'uncheck_step';
	const phaseIndex = resolvePhaseIndex(doc, args);
	const phase = doc.phases.find(p => p.index === phaseIndex);
	if (!phase) {
		return textResult(`Error: phase ${phaseIndex} not found.`, true);
	}
	const stepIndex = Number(args?.step_index);
	if (!Number.isInteger(stepIndex) || stepIndex < 1) {
		return textResult(
			`Error: action=${actionName} requires "step_index" (1-based number).`,
			true,
		);
	}
	if (stepIndex > phase.steps.length) {
		return textResult(
			`Error: step_index ${stepIndex} out of range — phase ${phase.index} has ${phase.steps.length} steps.`,
			true,
		);
	}
	await setStepChecked(doc.filePath, phase.index, stepIndex, checked);
	const updated = await parsePlanDocument(doc.filePath);
	const updatedPhase = updated.phases.find(p => p.index === phase.index)!;
	const remaining = updatedPhase.steps.filter(s => !s.checked);
	if (!checked) {
		return textResult(
			`Step ${stepIndex} unchecked in phase ${
				updatedPhase.index
			}. Remaining unchecked: ${
				remaining.map(s => s.text).join(' | ') || '(none)'
			}`,
		);
	}
	return textResult(
		remaining.length === 0
			? `Step ${stepIndex} checked. All steps of phase ${updatedPhase.index} are done — call plan-manage {action:"complete_phase"} to run acceptance and advance.`
			: `Step ${stepIndex} checked. Remaining steps in phase ${
					updatedPhase.index
			  }: ${remaining.map(s => s.text).join(' | ')}`,
	);
}

async function handleCompletePhase(
	doc: PlanDoc,
	cwd: string,
	abortSignal?: AbortSignal,
): Promise<CallToolResult> {
	const phase = currentPhaseOf(doc);
	if (!phase) {
		return textResult('Error: plan has no phases.', true);
	}
	const unchecked = phase.steps.filter(s => !s.checked);
	if (unchecked.length > 0) {
		return textResult(
			`Error: phase ${phase.index} still has unchecked steps: ${unchecked
				.map(s => s.text)
				.join(' | ')}. Finish them (and check_step) first.`,
			true,
		);
	}

	const acceptance = await runAcceptance(
		cwd,
		abortSignal,
		getPlanAcceptanceSettings(),
	);
	if (!acceptance.ok) {
		return textResult(
			`Phase ${phase.index} acceptance FAILED — fix the issues and call complete_phase again.\n${acceptance.output}`,
			true,
		);
	}

	const isLast =
		doc.phases.length === 0 ||
		phase.index >= Math.max(...doc.phases.map(p => p.index));
	if (isLast) {
		return textResult(
			`Phase ${phase.index} acceptance passed (${acceptance.output}). This was the last phase — call plan-manage {action:"complete"} for final acceptance and archiving.`,
		);
	}

	const nextIndex = phase.index + 1;
	await writePlanFrontmatter(doc.filePath, {current_phase: nextIndex});

	const updated = await parsePlanDocument(doc.filePath);
	setPlanScope(getSessionId(), {
		planPath: updated.filePath,
		files: resolvePlanScopeFiles(updated),
		cwd,
	});
	const next = updated.phases.find(p => p.index === nextIndex);
	return textResult(
		`Phase ${phase.index} accepted (${
			acceptance.output
		}). Now on phase ${nextIndex}: ${next?.title ?? ''}.\nSteps:\n${(
			next?.steps ?? []
		)
			.map(s => `- [ ] ${s.text}`)
			.join('\n')}`,
	);
}

async function handleAmend(
	doc: PlanDoc,
	cwd: string,
	args: any,
): Promise<CallToolResult> {
	const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
	if (!reason) {
		return textResult('Error: action=amend requires "reason".', true);
	}
	const phaseIndex = resolvePhaseIndex(doc, args);
	const phase = doc.phases.find(p => p.index === phaseIndex);
	if (!phase) {
		return textResult(`Error: phase ${phaseIndex} not found.`, true);
	}
	const addFiles: string[] = Array.isArray(args?.add_files)
		? args.add_files.filter((f: unknown) => typeof f === 'string')
		: [];
	const addSteps: string[] = Array.isArray(args?.add_steps)
		? args.add_steps.filter((s: unknown) => typeof s === 'string')
		: [];
	if (addFiles.length === 0 && addSteps.length === 0) {
		return textResult(
			'Error: action=amend requires "add_files" and/or "add_steps".',
			true,
		);
	}

	// Insert after the last existing entry of each section (line-anchored).
	const matter = (await import('gray-matter')).default;
	const raw = (await fs.readFile(doc.filePath, 'utf8')).replace(/^\uFEFF/, '');
	const parsed = matter(raw);
	const lines = parsed.content.split(/\r?\n/);

	// Re-parse for stable line anchors
	const freshDoc = await parsePlanDocument(doc.filePath);
	const freshPhase = freshDoc.phases.find(p => p.index === phaseIndex)!;

	if (addSteps.length > 0) {
		const lastStep = freshPhase.steps[freshPhase.steps.length - 1];
		const insertAt = lastStep
			? lastStep.line + 1
			: findSectionAnchor(lines, phaseIndex, 'Steps');
		lines.splice(insertAt, 0, ...addSteps.map(s => `  - [ ] ${s}`));
	}
	if (addFiles.length > 0) {
		// Recompute anchors after possible steps insertion by matching Files section
		const filesAnchor = findSectionAnchor(lines, phaseIndex, 'Files');
		lines.splice(filesAnchor, 0, ...addFiles.map(f => `  - ${f}`));
	}
	lines.push(
		'',
		`> Amended: ${reason} (${new Date().toISOString().slice(0, 10)})`,
	);

	const output = matter.stringify(lines.join(doc.eol), parsed.data);
	await fs.writeFile(doc.filePath, output, 'utf8');

	const updated = await parsePlanDocument(doc.filePath);
	setPlanScope(getSessionId(), {
		planPath: updated.filePath,
		files: resolvePlanScopeFiles(updated),
		cwd,
	});
	return textResult(
		`Plan amended (phase ${phaseIndex}): +${addFiles.length} files, +${addSteps.length} steps. Scope refreshed.`,
	);
}

/**
 * Find the line index right after a phase's `**Section**` label (creating the
 * section at the end of the phase when missing). Returns an insertion index.
 */
function isPhaseHeadingLine(line: string, phaseIndex: number): boolean {
	const match = /^#{2,3}\s+Phase\s+(\d+)\b/i.exec(line);
	return Boolean(match && Number(match[1]) === phaseIndex);
}

function findSectionAnchor(
	lines: string[],
	phaseIndex: number,
	section: 'Files' | 'Steps',
): number {
	const sectionNeedle = `**${section}`;
	let inPhase = false;
	let phaseEnd = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (isPhaseHeadingLine(line, phaseIndex)) {
			inPhase = true;
			continue;
		}
		if (inPhase && /^#{1,3}\s/.test(line)) {
			phaseEnd = i;
			break;
		}
		if (inPhase && line.includes(sectionNeedle)) {
			return i + 1;
		}
	}
	// Section missing: create the label at the end of the phase
	const label = `- **${section}**:`;
	lines.splice(phaseEnd, 0, label);
	return phaseEnd + 1;
}

async function handleComplete(
	doc: PlanDoc,
	cwd: string,
	abortSignal?: AbortSignal,
): Promise<CallToolResult> {
	const unchecked = doc.phases.flatMap(p =>
		p.steps.filter(s => !s.checked).map(s => `phase ${p.index}: ${s.text}`),
	);
	if (unchecked.length > 0) {
		return textResult(
			`Error: plan still has unchecked steps — ${unchecked.join(
				' | ',
			)}. Finish them first.`,
			true,
		);
	}

	const acceptance = await runAcceptance(
		cwd,
		abortSignal,
		getPlanAcceptanceSettings(),
	);
	if (!acceptance.ok) {
		return textResult(
			`Final acceptance FAILED — fix the issues and call complete again.\n${acceptance.output}`,
			true,
		);
	}

	await writePlanFrontmatter(doc.filePath, {status: 'completed'});
	const completedDoc = await parsePlanDocument(doc.filePath);
	const archivedTo = await archivePlan(completedDoc, cwd);
	return textResult(
		`Plan completed (${acceptance.output}) and archived to ${archivedTo}.`,
	);
}

async function handleAbandon(
	doc: PlanDoc,
	cwd: string,
	args: any,
): Promise<CallToolResult> {
	const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
	if (!reason) {
		return textResult('Error: action=abandon requires "reason".', true);
	}

	const matter = (await import('gray-matter')).default;
	const raw = (await fs.readFile(doc.filePath, 'utf8')).replace(/^\uFEFF/, '');
	const parsed = matter(raw);
	const body = parsed.content.endsWith('\n')
		? parsed.content
		: parsed.content + '\n';
	const nextBody =
		body +
		`\n> Abandoned: ${reason} (${new Date().toISOString().slice(0, 10)})\n`;
	await fs.writeFile(
		doc.filePath,
		matter.stringify(nextBody, parsed.data),
		'utf8',
	);

	await writePlanFrontmatter(doc.filePath, {status: 'abandoned'});
	resetPlanGate(getSessionId());
	const abandonedDoc = await parsePlanDocument(doc.filePath);
	const archivedTo = await archivePlan(abandonedDoc, cwd, 'abandoned');
	return textResult(`Plan abandoned and archived to ${archivedTo}.`);
}

async function handleAdopt(cwd: string, args: any): Promise<CallToolResult> {
	const sessionId = getSessionId();
	let doc: PlanDoc | null = null;

	if (typeof args?.plan_path === 'string' && args.plan_path.trim()) {
		const planPath = path.isAbsolute(args.plan_path)
			? args.plan_path
			: path.resolve(cwd, args.plan_path);
		try {
			doc = await parsePlanDocument(planPath);
		} catch (error) {
			return textResult(
				`Error: cannot parse plan at ${planPath}: ${
					error instanceof Error ? error.message : String(error)
				}`,
				true,
			);
		}
	} else {
		const docs = await findSessionPlanFiles(cwd, null);
		doc =
			docs
				.filter(d => d.frontmatter.status === 'executing')
				.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
	}

	if (!doc) {
		return textResult(
			'Error: no executing plan found to adopt. Pass plan_path or leave an unfinished executing plan under .snow/plan/.',
			true,
		);
	}

	const currentPhase = Math.max(1, doc.frontmatter.current_phase || 1);
	// Always rebind to the current session id (empty string when no session manager entry).
	const boundSession = sessionId ?? '';
	await writePlanFrontmatter(doc.filePath, {
		session: boundSession,
		status: 'executing',
		current_phase: currentPhase,
	});
	const updated = await parsePlanDocument(doc.filePath);
	setPlanApproved(sessionId, true);
	setPlanScope(sessionId, {
		planPath: updated.filePath,
		files: resolvePlanScopeFiles(updated),
		cwd,
	});
	return textResult(
		`Adopted plan ${updated.filePath} into session ${
			boundSession || '(default)'
		}; status=executing phase=${currentPhase}; gate approved.`,
	);
}

async function handleCreate(cwd: string, args: any): Promise<CallToolResult> {
	const title = typeof args?.title === 'string' ? args.title.trim() : '';
	if (!title) {
		return textResult('Error: action=create requires "title".', true);
	}
	const complexityRaw =
		typeof args?.complexity === 'string' ? args.complexity : 'simple';
	const complexity: PlanComplexity =
		complexityRaw === 'medium' || complexityRaw === 'complex'
			? complexityRaw
			: 'simple';
	const session =
		typeof args?.session === 'string' && args.session.trim()
			? args.session.trim()
			: getSessionId() ?? '';
	const context = typeof args?.context === 'string' ? args.context : undefined;
	const baseSlug =
		typeof args?.slug === 'string' && args.slug.trim()
			? slugifyPlanTitle(args.slug)
			: slugifyPlanTitle(title);

	const dateDir = getPlanDateDir(cwd);
	await fs.mkdir(dateDir, {recursive: true});

	let slug = baseSlug;
	let filePath = path.join(dateDir, `${slug}.md`);
	for (let n = 2; ; n++) {
		try {
			await fs.access(filePath);
			slug = `${baseSlug}-${n}`;
			filePath = path.join(dateDir, `${slug}.md`);
		} catch {
			break;
		}
	}

	const content = buildPlanMarkdown({
		title,
		session,
		complexity,
		context,
	});
	await fs.writeFile(filePath, content, 'utf8');
	return textResult(
		`Created draft plan at ${filePath} (complexity=${complexity}). Review, then ask for approval via askuser-ask_question.`,
	);
}

export async function executePlanManageTool(
	toolName: string,
	args: any,
	abortSignal?: AbortSignal,
	cwdOverride?: string,
): Promise<CallToolResult> {
	void toolName;
	const cwd = cwdOverride || process.cwd();
	try {
		const action = (typeof args?.action === 'string' ? args.action : '') as
			| PlanAction
			| '';
		if (!PLAN_ACTIONS.includes(action as PlanAction)) {
			return textResult(
				`Error: "action" must be one of: ${PLAN_ACTIONS.join(', ')}`,
				true,
			);
		}

		if (action === 'list') {
			const docs = await findSessionPlanFiles(cwd, null);
			if (docs.length === 0) {
				return textResult('No active plans under .snow/plan/.');
			}
			const lines = docs
				.sort((a, b) => b.mtimeMs - a.mtimeMs)
				.map(d => {
					const title =
						d.frontmatter.title || d.title || path.basename(d.filePath);
					return `- [${d.frontmatter.status}] ${title} | session=${
						d.frontmatter.session || '(none)'
					} | phase=${d.frontmatter.current_phase} | ${d.filePath}`;
				});
			return textResult(`Active plans (${docs.length}):\n${lines.join('\n')}`);
		}

		if (action === 'create') {
			return await handleCreate(cwd, args);
		}

		if (action === 'adopt') {
			return await handleAdopt(cwd, args);
		}

		const found = await requireActivePlan(cwd);
		if ('error' in found) {
			return found.error;
		}

		switch (action) {
			case 'get':
				return textResult(summarizePlan(found.doc));
			case 'status':
				return textResult(statusLine(found.doc));
			case 'check_step':
				return await handleCheckStep(found.doc, args, true);
			case 'uncheck_step':
				return await handleCheckStep(found.doc, args, false);
			case 'complete_phase':
				return await handleCompletePhase(found.doc, cwd, abortSignal);
			case 'amend':
				return await handleAmend(found.doc, cwd, args);
			case 'complete':
				return await handleComplete(found.doc, cwd, abortSignal);
			case 'abandon':
				return await handleAbandon(found.doc, cwd, args);
			default:
				return textResult(`Unknown plan action: ${action}`, true);
		}
	} catch (error) {
		return textResult(
			`Error executing plan-manage: ${
				error instanceof Error ? error.message : String(error)
			}`,
			true,
		);
	}
}
