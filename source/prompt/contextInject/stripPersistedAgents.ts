/**
 * Read-time cleanup for user messages that historically persisted AGENTS inject.
 * Prefer `originalContent` at the call site when available; this helper is the
 * fallback when only the dirty `content` field remains.
 */

export const AGENTS_CONTEXT_HEADING = '## Project Context (AGENTS.md)';

/** Appended by render so future accidental persists can be stripped safely. */
export const AGENTS_INJECT_END_MARKER = '<!-- snow:agents-inject:end -->';

const AGENTS_INTRO =
	'Instructions loaded from AGENTS.md (and optional CLAUDE.md fallback). Follow unless the user explicitly overrides. ROLE.md persona rules are separate and still apply.';

function isAgentsSectionHeader(line: string): boolean {
	return (
		line.startsWith('### Global AGENTS — `') ||
		line.startsWith('### Project AGENTS — `') ||
		line.startsWith('### AGENTS — `')
	);
}

/**
 * Strip a leading AGENTS inject block from a stored user message body.
 * Conservative: only touches content that starts with the inject heading.
 */
export function stripPersistedAgentsContext(content: string): string {
	if (!content || !content.includes(AGENTS_CONTEXT_HEADING)) {
		return content;
	}

	const leftTrimmed = content.trimStart();
	if (!leftTrimmed.startsWith(AGENTS_CONTEXT_HEADING)) {
		return content;
	}

	// Preferred: explicit end marker (current render format).
	const endIdx = leftTrimmed.indexOf(AGENTS_INJECT_END_MARKER);
	if (endIdx !== -1) {
		return leftTrimmed
			.slice(endIdx + AGENTS_INJECT_END_MARKER.length)
			.replace(/^\r?\n+/, '');
	}

	// Legacy renders / tests without end marker.
	let rest = leftTrimmed
		.slice(AGENTS_CONTEXT_HEADING.length)
		.replace(/^\r?\n+/, '');

	if (rest.startsWith(AGENTS_INTRO)) {
		rest = rest.slice(AGENTS_INTRO.length).replace(/^\r?\n+/, '');

		const lines = rest.split('\n');
		let i = 0;
		let sawSection = false;

		while (i < lines.length && isAgentsSectionHeader(lines[i] ?? '')) {
			sawSection = true;
			i += 1; // header
			// optional blank line after header
			if (i < lines.length && (lines[i] ?? '') === '') {
				i += 1;
			}
			// body until next header / note / end
			while (i < lines.length) {
				const line = lines[i] ?? '';
				if (isAgentsSectionHeader(line)) {
					break;
				}
				if (line.startsWith('_Note: AGENTS context was truncated')) {
					break;
				}
				// blank line may start user text after final section
				if (line === '') {
					const next = lines[i + 1] ?? '';
					if (
						isAgentsSectionHeader(next) ||
						next.startsWith('_Note: AGENTS context was truncated')
					) {
						i += 1;
						continue;
					}
					// Treat remaining as user text.
					return lines.slice(i + 1).join('\n');
				}
				i += 1;
			}
		}

		if (
			i < lines.length &&
			(lines[i] ?? '').startsWith('_Note: AGENTS context was truncated')
		) {
			i += 1;
			if (i < lines.length && (lines[i] ?? '') === '') {
				i += 1;
			}
		}

		void sawSection;
		return lines.slice(i).join('\n');
	}

	// Simple section (tests / custom): heading + body + \n\n + user
	const sep = rest.indexOf('\n\n');
	if (sep === -1) {
		return '';
	}
	return rest.slice(sep + 2);
}

/**
 * Resolve the clean user body for API history / resume display.
 * `originalContent` wins; otherwise strip a leading AGENTS inject when detected.
 */
export function resolvePersistedUserContent(msg: {
	content?: unknown;
	originalContent?: unknown;
}): string {
	if (typeof msg.originalContent === 'string') {
		return msg.originalContent;
	}
	const content =
		typeof msg.content === 'string'
			? msg.content
			: msg.content == null
				? ''
				: String(msg.content);
	return stripPersistedAgentsContext(content);
}
