/**
 * Plan document parsing / writing / validation (Plan Mode enhancement base).
 *
 * Plan files live in `.snow/plan/*.md` with a yaml frontmatter state machine:
 * draft → approved → executing(phase N) → completed → archived.
 */

import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {listActivePlanMarkdownPaths} from './planPaths.js';

export type PlanStatus =
	| 'draft'
	| 'approved'
	| 'executing'
	| 'completed'
	| 'archived'
	| 'abandoned';

export type PlanComplexity = 'simple' | 'medium' | 'complex';

export interface PlanFrontmatter {
	status: PlanStatus;
	/** 1-based; 0 = not started */
	current_phase: number;
	created: string;
	session: string;
	approved_at?: string;
	title?: string;
	complexity?: PlanComplexity;
	updated_at?: string;
}

export interface PlanStep {
	text: string;
	checked: boolean;
	/** 0-based line index within the content (after frontmatter), for write-back */
	line: number;
}

export interface PlanPhase {
	index: number;
	title: string;
	files: string[];
	steps: PlanStep[];
	doneWhen: string[];
}

export interface PlanDoc {
	filePath: string;
	frontmatter: PlanFrontmatter;
	title: string;
	affectedFiles: string[];
	phases: PlanPhase[];
	raw: string;
	/** true when the file had no frontmatter (old format) */
	legacy: boolean;
	eol: '\n' | '\r\n';
	mtimeMs: number;
}

export interface PlanValidationIssue {
	code:
		| 'no_phases'
		| 'phase_no_steps'
		| 'phase_no_done_when'
		| 'missing_file'
		| 'complex_missing_sections';
	message: string;
}

const PLAN_STATUSES: PlanStatus[] = [
	'draft',
	'approved',
	'executing',
	'completed',
	'archived',
	'abandoned',
];

const PLAN_COMPLEXITIES: PlanComplexity[] = ['simple', 'medium', 'complex'];

export function normalizeFrontmatter(data: any): PlanFrontmatter {
	const source = data && typeof data === 'object' ? data : {};
	const status: PlanStatus = PLAN_STATUSES.includes(source.status)
		? source.status
		: 'draft';
	const rawPhase = Number(source.current_phase);
	const current_phase =
		Number.isFinite(rawPhase) && rawPhase >= 0 ? Math.floor(rawPhase) : 0;
	const created =
		typeof source.created === 'string' && source.created.trim()
			? source.created
			: '';
	const session = typeof source.session === 'string' ? source.session : '';
	const frontmatter: PlanFrontmatter = {
		status,
		current_phase,
		created,
		session,
	};
	if (typeof source.approved_at === 'string' && source.approved_at.trim()) {
		frontmatter.approved_at = source.approved_at;
	}
	if (typeof source.title === 'string' && source.title.trim()) {
		frontmatter.title = source.title.trim();
	}
	if (
		typeof source.complexity === 'string' &&
		PLAN_COMPLEXITIES.includes(source.complexity as PlanComplexity)
	) {
		frontmatter.complexity = source.complexity as PlanComplexity;
	}
	if (typeof source.updated_at === 'string' && source.updated_at.trim()) {
		frontmatter.updated_at = source.updated_at;
	}
	return frontmatter;
}

const PHASE_HEADING_RE = /^#{2,3}\s+Phase\s+(\d+)\s*[:：]?\s*(.*)$/i;
const SECTION_RE =
	/^(?:[-*]\s+)?\*\*(Files|Steps|Done when|文件|步骤|完成标准)\**\s*[:：]?\s*\**\s*[:：]?\s*(.*)$/i;
const CHECKBOX_RE = /^\s*-\s*\[( |x|X)\]\s+(.*)$/;
const LIST_ITEM_RE = /^\s*-\s+(.*)$/;
const AFFECTED_FILES_RE = /^##\s+Affected files/i;

type PhaseSection = 'files' | 'steps' | 'doneWhen' | null;

function sectionKey(label: string): PhaseSection {
	const lower = label.toLowerCase();
	if (lower === 'files' || label === '文件') return 'files';
	if (lower === 'steps' || label === '步骤') return 'steps';
	if (lower === 'done when' || label === '完成标准') return 'doneWhen';
	return null;
}

function cleanListPath(text: string): string {
	return text.trim().replace(/^`|`$/g, '').trim();
}

export function parsePhasesFromMarkdown(content: string): {
	title: string;
	affectedFiles: string[];
	phases: PlanPhase[];
} {
	const lines = content.split(/\r?\n/);
	let title = '';
	const affectedFiles: string[] = [];
	const phases: PlanPhase[] = [];

	let currentPhase: PlanPhase | null = null;
	let currentSection: PhaseSection = null;
	let inAffectedFiles = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		if (!title) {
			const titleMatch = /^#\s+(.*)$/.exec(line);
			if (titleMatch) {
				title = titleMatch[1]!.trim();
				continue;
			}
		}

		const phaseMatch = PHASE_HEADING_RE.exec(line);
		if (phaseMatch) {
			currentPhase = {
				index: Number(phaseMatch[1]),
				title: phaseMatch[2]!.trim(),
				files: [],
				steps: [],
				doneWhen: [],
			};
			phases.push(currentPhase);
			currentSection = null;
			inAffectedFiles = false;
			continue;
		}

		if (AFFECTED_FILES_RE.test(line)) {
			inAffectedFiles = true;
			currentPhase = null;
			currentSection = null;
			continue;
		}

		// Any other heading terminates affected-files / phase-section scope
		if (/^#{1,6}\s/.test(line)) {
			inAffectedFiles = false;
			currentSection = null;
			continue;
		}

		if (inAffectedFiles) {
			const item = LIST_ITEM_RE.exec(line);
			if (item) {
				const p = cleanListPath(item[1]!);
				if (p) affectedFiles.push(p);
			}
			continue;
		}

		if (!currentPhase) {
			continue;
		}

		const sectionMatch = SECTION_RE.exec(line);
		if (sectionMatch) {
			currentSection = sectionKey(sectionMatch[1]!);
			// Inline content after the label, e.g. "**Files**: a.ts, b.ts"
			const inline = sectionMatch[2]?.trim();
			if (inline && currentSection === 'files') {
				for (const part of inline.split(',')) {
					const p = cleanListPath(part);
					if (p) currentPhase.files.push(p);
				}
			} else if (inline && currentSection === 'doneWhen') {
				currentPhase.doneWhen.push(inline);
			}
			continue;
		}

		if (!currentSection) {
			continue;
		}

		const checkbox = CHECKBOX_RE.exec(line);
		if (checkbox && currentSection === 'steps') {
			currentPhase.steps.push({
				text: checkbox[2]!.trim(),
				checked: checkbox[1]!.toLowerCase() === 'x',
				line: i,
			});
			continue;
		}

		const item = LIST_ITEM_RE.exec(line);
		if (item) {
			const text = cleanListPath(item[1]!);
			if (!text) continue;
			if (currentSection === 'files') {
				currentPhase.files.push(text);
			} else if (currentSection === 'steps') {
				// Tolerant: non-checkbox list item counts as unchecked step
				currentPhase.steps.push({
					text: item[1]!.trim(),
					checked: false,
					line: i,
				});
			} else {
				currentPhase.doneWhen.push(item[1]!.trim());
			}
		}
	}

	return {title, affectedFiles, phases};
}

export async function parsePlanDocument(filePath: string): Promise<PlanDoc> {
	const absPath = path.resolve(filePath);
	const [rawBuffer, stat] = await Promise.all([
		fs.readFile(absPath, 'utf8'),
		fs.stat(absPath),
	]);
	const raw = rawBuffer.replace(/^﻿/, '');
	const parsed = matter(raw);
	const legacy = !parsed.data || Object.keys(parsed.data).length === 0;
	const frontmatter = normalizeFrontmatter(parsed.data);
	if (!frontmatter.created) {
		frontmatter.created = stat.mtime.toISOString();
	}
	const eol: '\n' | '\r\n' = raw.includes('\r\n') ? '\r\n' : '\n';
	const {title, affectedFiles, phases} = parsePhasesFromMarkdown(
		parsed.content,
	);
	return {
		filePath: absPath,
		frontmatter,
		title,
		affectedFiles,
		phases,
		raw: parsed.content,
		legacy,
		eol,
		mtimeMs: stat.mtimeMs,
	};
}

export async function writePlanFrontmatter(
	filePath: string,
	patch: Partial<PlanFrontmatter>,
): Promise<void> {
	const absPath = path.resolve(filePath);
	const raw = (await fs.readFile(absPath, 'utf8')).replace(/^\uFEFF/, '');
	const parsed = matter(raw);
	const merged = {...normalizeFrontmatter(parsed.data), ...patch};
	const now = new Date().toISOString();
	if (!merged.created) {
		merged.created = now;
	}
	merged.updated_at = now;
	const output = matter.stringify(parsed.content, merged);
	await fs.writeFile(absPath, output, 'utf8');
}

export async function setStepChecked(
	filePath: string,
	phaseIndex: number,
	stepIndex: number,
	checked: boolean,
): Promise<void> {
	const doc = await parsePlanDocument(filePath);
	const phase = doc.phases.find(p => p.index === phaseIndex);
	if (!phase) {
		throw new Error(`Phase ${phaseIndex} not found in ${filePath}`);
	}
	const step = phase.steps[stepIndex - 1];
	if (!step) {
		throw new Error(
			`Step ${stepIndex} not found in phase ${phaseIndex} (has ${phase.steps.length} steps)`,
		);
	}

	const raw = (await fs.readFile(doc.filePath, 'utf8')).replace(/^﻿/, '');
	const parsed = matter(raw);
	const lines = parsed.content.split(/\r?\n/);
	const target = lines[step.line];
	if (target === undefined) {
		throw new Error(`Step line ${step.line} out of range in ${filePath}`);
	}
	const mark = checked ? 'x' : ' ';
	const replaced = target.replace(/-\s*\[( |x|X)\]/, `- [${mark}]`);
	const finalLine =
		replaced === target && !CHECKBOX_RE.test(target)
			? // Tolerant step (plain list item): convert to checkbox
			  target.replace(/^(\s*)-\s+/, `$1- [${mark}] `)
			: replaced;
	lines[step.line] = finalLine;
	const output = matter.stringify(
		lines.join(doc.eol),
		normalizeFrontmatter(parsed.data),
	);
	await fs.writeFile(doc.filePath, output, 'utf8');
}

const NEW_FILE_MARKER_RE = /\((new|新建|create[ds]?)\)/i;

export function validatePlanDocument(
	doc: PlanDoc,
	cwd: string,
): PlanValidationIssue[] {
	const issues: PlanValidationIssue[] = [];

	if (doc.phases.length === 0) {
		issues.push({
			code: 'no_phases',
			message:
				'Plan has no phases. Use "### Phase N: title" headings with **Files** / **Steps** / **Done when** sections.',
		});
		return issues;
	}

	for (const phase of doc.phases) {
		if (phase.steps.length === 0) {
			issues.push({
				code: 'phase_no_steps',
				message: `Phase ${phase.index} ("${phase.title}") has no **Steps** checklist (use "- [ ] step").`,
			});
		}
		if (phase.doneWhen.length === 0) {
			issues.push({
				code: 'phase_no_done_when',
				message: `Phase ${phase.index} ("${phase.title}") has no **Done when** criteria.`,
			});
		}
	}

	const candidates =
		doc.affectedFiles.length > 0
			? doc.affectedFiles
			: [...new Set(doc.phases.flatMap(p => p.files))];
	for (const file of candidates) {
		if (NEW_FILE_MARKER_RE.test(file)) {
			continue;
		}
		const cleaned = file.replace(/\s*\(.*\)\s*$/, '').trim();
		if (!cleaned || /[*?]/.test(cleaned)) {
			continue;
		}
		if (!existsSync(path.resolve(cwd, cleaned))) {
			issues.push({
				code: 'missing_file',
				message: `Plan references non-existent file "${cleaned}". Fix the path or mark it as "(new)".`,
			});
		}
	}

	if (doc.frontmatter.complexity === 'complex') {
		const body = doc.raw || '';
		if (!/Risks/i.test(body) && !/Rollback/i.test(body)) {
			issues.push({
				code: 'complex_missing_sections',
				message:
					'Complex plans must include a Risks and/or Rollback section (e.g. "## Risks & Mitigations" or "## Rollback Strategy").',
			});
		}
	}

	return issues;
}

export {getPlanDir} from './planPaths.js';

export async function findSessionPlanFiles(
	cwd: string,
	sessionId: string | null | undefined,
): Promise<PlanDoc[]> {
	const planPaths = await listActivePlanMarkdownPaths(cwd);

	const docs: PlanDoc[] = [];
	for (const planPath of planPaths) {
		try {
			docs.push(await parsePlanDocument(planPath));
		} catch {
			// Unreadable/malformed file: skip
		}
	}

	if (!sessionId) {
		return docs;
	}
	const matched = docs.filter(d => d.frontmatter.session === sessionId);
	if (matched.length > 0) {
		return matched;
	}
	// Legacy fallback: only untagged (no session) plans may be adopted;
	// plans owned by other sessions go through the resume-notice flow instead.
	const untagged = docs.filter(d => !d.frontmatter.session);
	if (untagged.length > 0) {
		const latest = [...untagged].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]!;
		return [latest];
	}
	return [];
}

const STATUS_PRIORITY: Record<PlanStatus, number> = {
	executing: 0,
	approved: 1,
	draft: 2,
	completed: 3,
	archived: 4,
	abandoned: 5,
};

export async function findActivePlan(
	cwd: string,
	sessionId: string | null | undefined,
): Promise<PlanDoc | null> {
	const docs = await findSessionPlanFiles(cwd, sessionId);
	const active = docs.filter(d =>
		['executing', 'approved', 'draft'].includes(d.frontmatter.status),
	);
	if (active.length === 0) {
		return null;
	}
	active.sort(
		(a, b) =>
			STATUS_PRIORITY[a.frontmatter.status] -
				STATUS_PRIORITY[b.frontmatter.status] || b.mtimeMs - a.mtimeMs,
	);
	return active[0]!;
}
