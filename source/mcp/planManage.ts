import {
	type Tool,
	type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	findActivePlan,
	parsePlanDocument,
	setStepChecked,
	writePlanFrontmatter,
	type PlanDoc,
	type PlanPhase,
} from '../utils/execution/planDocument.js';
import {
	setPlanScope,
	resolvePlanScopeFiles,
} from '../utils/execution/planModeGate.js';
import {archivePlan} from '../utils/execution/planArchive.js';
import {sessionManager} from '../utils/session/sessionManager.js';

const MAX_ACCEPTANCE_OUTPUT = 4000;

/**
 * Plan Mode 执行期管理工具：勾选步骤、阶段验收推进、修订计划、完成归档。
 * 参考 todo-manage / notebook-manage 的单工具 action 枚举模式。
 */
export const planManageTools: Tool[] = [
	{
		name: 'plan-manage',
		description: `Manage the active plan under .snow/plan/ during Plan Mode execution. Required field "action":

- check_step: Mark a step done in the current phase. Required "step_index" (1-based). Call immediately after finishing each step.
- complete_phase: Run acceptance (build + IDE diagnostics) for the current phase. On success advances current_phase and returns the next phase's steps. All steps of the phase must be checked first.
- amend: Update the plan when scope changes. Optional "phase_index" (defaults to current), "add_files" (paths to add to the phase's Files list), "add_steps" (steps to append), required "reason". Use BEFORE editing files outside the plan's file list.
- complete: Final acceptance after ALL phases are done; archives the plan to .snow/plan/archive/YYYY-MM-DD/.

The plan file is the source of truth — keep it in sync with reality via these actions.`,
		inputSchema: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					enum: ['check_step', 'complete_phase', 'amend', 'complete'],
					description: 'Which plan operation to run.',
				},
				step_index: {
					type: 'number',
					description:
						'For action=check_step: 1-based step index within the current phase.',
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
						'For action=amend: why the plan changed (recorded in the plan file).',
				},
			},
			required: ['action'],
		},
	},
];

function textResult(text: string, isError = false): CallToolResult {
	return {content: [{type: 'text', text}], ...(isError ? {isError: true} : {})};
}

function truncate(text: string, max = MAX_ACCEPTANCE_OUTPUT): string {
	return text.length > max ? text.slice(0, max) + '\n... (truncated)' : text;
}

function getSessionId(): string | null {
	return sessionManager.getCurrentSession()?.id ?? null;
}

function currentPhaseOf(doc: PlanDoc): PlanPhase | undefined {
	const idx = Math.max(1, doc.frontmatter.current_phase);
	return doc.phases.find(p => p.index === idx) ?? doc.phases[0];
}

/**
 * Code-level acceptance: run the project's build script (if any) and check
 * IDE diagnostics. Missing build script / disconnected IDE are skipped, not
 * failures.
 */
export async function runAcceptance(
	cwd: string,
	abortSignal?: AbortSignal,
): Promise<{ok: boolean; output: string}> {
	const parts: string[] = [];

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted'};
	}

	let hasBuild = false;
	try {
		const pkgRaw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
		const pkg = JSON.parse(pkgRaw);
		hasBuild = typeof pkg?.scripts?.build === 'string';
	} catch {
		parts.push('build: no package.json, skipped');
	}

	if (hasBuild) {
		try {
			const {terminalService} = await import('./bash.js');
			const result = await terminalService.executeCommand(
				'npm run build',
				300000,
				abortSignal,
			);
			const exitCode = result.exitCode;
			const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
			if (typeof exitCode === 'number' && exitCode !== 0) {
				return {
					ok: false,
					output: `build FAILED (exit ${exitCode}):\n${truncate(output)}`,
				};
			}
			parts.push('build: passed');
		} catch (error) {
			return {
				ok: false,
				output: `build FAILED: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	} else if (parts.length === 0) {
		parts.push('build: no build script, skipped');
	}

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted'};
	}

	try {
		const {executeMCPTool} = await import(
			'../utils/execution/mcpToolsManager.js'
		);
		const diag = await executeMCPTool('ide-get_diagnostics', {}, abortSignal);
		const diagText =
			typeof diag === 'string' ? diag : JSON.stringify(diag ?? '');
		const errorCount = (
			diagText.match(/"severity"\s*:\s*"?(error|1)"?/gi) || []
		).length;
		if (errorCount > 0) {
			return {
				ok: false,
				output: `${parts.join(
					'; ',
				)}; diagnostics FAILED (${errorCount} errors):\n${truncate(diagText)}`,
			};
		}
		parts.push('diagnostics: no errors');
	} catch {
		parts.push('diagnostics: IDE not connected, skipped');
	}

	return {ok: true, output: parts.join('; ')};
}

async function requireActivePlan(
	cwd: string,
): Promise<{doc: PlanDoc} | {error: CallToolResult}> {
	const doc = await findActivePlan(cwd, getSessionId());
	if (!doc) {
		return {
			error: textResult(
				'Error: no active plan found under .snow/plan/. Create and get the plan approved first.',
				true,
			),
		};
	}
	return {doc};
}

async function handleCheckStep(
	doc: PlanDoc,
	args: any,
): Promise<CallToolResult> {
	const phase = currentPhaseOf(doc);
	if (!phase) {
		return textResult('Error: plan has no phases.', true);
	}
	const stepIndex = Number(args?.step_index);
	if (!Number.isInteger(stepIndex) || stepIndex < 1) {
		return textResult(
			'Error: action=check_step requires "step_index" (1-based number).',
			true,
		);
	}
	if (stepIndex > phase.steps.length) {
		return textResult(
			`Error: step_index ${stepIndex} out of range — phase ${phase.index} has ${phase.steps.length} steps.`,
			true,
		);
	}
	await setStepChecked(doc.filePath, phase.index, stepIndex, true);
	const updated = await parsePlanDocument(doc.filePath);
	const updatedPhase = currentPhaseOf(updated)!;
	const remaining = updatedPhase.steps.filter(s => !s.checked);
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

	const acceptance = await runAcceptance(cwd, abortSignal);
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
	const phaseIndex = Number.isInteger(Number(args?.phase_index))
		? Number(args.phase_index)
		: Math.max(1, doc.frontmatter.current_phase);
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
	const raw = (await fs.readFile(doc.filePath, 'utf8')).replace(/^﻿/, '');
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
function findSectionAnchor(
	lines: string[],
	phaseIndex: number,
	section: 'Files' | 'Steps',
): number {
	const phaseRe = new RegExp(`^#{2,3}\\s+Phase\\s+${phaseIndex}\\b`, 'i');
	const sectionRe = new RegExp(`^(?:[-*]\\s+)?\\*\\*${section}`, 'i');
	let inPhase = false;
	let phaseEnd = lines.length;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (phaseRe.test(line)) {
			inPhase = true;
			continue;
		}
		if (inPhase && /^#{1,3}\s/.test(line)) {
			phaseEnd = i;
			break;
		}
		if (inPhase && sectionRe.test(line)) {
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

	const acceptance = await runAcceptance(cwd, abortSignal);
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

export async function executePlanManageTool(
	toolName: string,
	args: any,
	abortSignal?: AbortSignal,
	cwdOverride?: string,
): Promise<CallToolResult> {
	void toolName;
	const cwd = cwdOverride || process.cwd();
	try {
		const action = typeof args?.action === 'string' ? args.action : '';
		if (
			!['check_step', 'complete_phase', 'amend', 'complete'].includes(action)
		) {
			return textResult(
				'Error: "action" must be one of: check_step, complete_phase, amend, complete',
				true,
			);
		}

		const found = await requireActivePlan(cwd);
		if ('error' in found) {
			return found.error;
		}

		switch (action) {
			case 'check_step':
				return await handleCheckStep(found.doc, args);
			case 'complete_phase':
				return await handleCompletePhase(found.doc, cwd, abortSignal);
			case 'amend':
				return await handleAmend(found.doc, cwd, args);
			case 'complete':
				return await handleComplete(found.doc, cwd, abortSignal);
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
