import type {LoadedSource} from './types.js';
import {AGENTS_INJECT_END_MARKER} from './stripPersistedAgents.js';

function kindHeading(kind: LoadedSource['kind']): string {
	switch (kind) {
		case 'global-agents':
			return 'Global AGENTS';
		case 'project-agents':
			return 'Project AGENTS';
		default:
			return 'AGENTS';
	}
}

/**
 * Render injected AGENTS section. Empty kept => ''.
 */
export function renderInjectedRulesSection(
	kept: LoadedSource[],
	meta?: {truncated?: boolean; breadcrumbPath?: string},
): string {
	if (!kept.length) {
		return '';
	}

	const parts: string[] = [
		'## Project Context (AGENTS.md)',
		'',
		'Instructions loaded from AGENTS.md (and optional CLAUDE.md fallback). Follow unless the user explicitly overrides. ROLE.md persona rules are separate and still apply.',
		'',
	];

	for (const source of kept) {
		parts.push(`### ${kindHeading(source.kind)} — \`${source.relLabel}\``);
		parts.push('');
		parts.push(source.content.trim());
		parts.push('');
	}

	if (meta?.truncated) {
		const pathNote = meta.breadcrumbPath
			? ` Full text: \`${meta.breadcrumbPath}\`.`
			: '';
		parts.push(
			`_Note: AGENTS context was truncated to fit budget.${pathNote}_\n`,
		);
	}

	// End marker enables read-time strip if this block is ever persisted.
	parts.push(AGENTS_INJECT_END_MARKER);

	return parts.join('\n').trimEnd() + '\n';
}

export function appendInjectedRules(prompt: string, section: string): string {
	if (!section || !section.trim()) {
		return prompt;
	}
	return `${prompt.trimEnd()}\n\n${section.trim()}\n`;
}

/**
 * Prepend AGENTS context onto a model-bound user message.
 * Separate from hook additionalContext — call this on its own path.
 */
export function prependAgentsContext(message: string, section: string): string {
	if (!section || !section.trim()) {
		return message;
	}
	if (!message) {
		return section.trim();
	}
	return `${section.trim()}\n\n${message}`;
}
