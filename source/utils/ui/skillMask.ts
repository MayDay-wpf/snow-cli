// Utility to visually hide injected Skill blocks while keeping the raw text intact.
// A "Skill block" is the content inserted by the SkillsPicker (see useSkillsPicker.ts).

export type SkillMaskResult = {
	displayText: string;
	skillIds: string[];
};

function isSkillHeaderLine(line: string): boolean {
	return line.startsWith('# Skill:');
}

function splitSkillEndRemainder(line: string): string | null {
	// 正常情况下 end marker 应该独占一行："# Skill End"。
	// 但历史消息里可能出现 "# Skill End<user text>" 的黏连情况（占位符内容没以换行结尾）。
	// 这里做兼容：把 end marker 视为结束，并把后续内容作为普通文本保留下来。
	const trimmed = line.trimStart();
	if (!trimmed.startsWith('# Skill End')) return null;
	return trimmed.slice('# Skill End'.length);
}

function isSkillEndLine(line: string): boolean {
	return line.trim() === '# Skill End';
}

function parseSkillIdFromHeader(line: string): string {
	// Line format: "# Skill: <id>"
	return line.replace(/^# Skill:\s*/i, '').trim() || 'unknown';
}

export function maskSkillInjectedText(text: string): SkillMaskResult {
	if (!text) return {displayText: text, skillIds: []};

	const lines = text.split('\n');
	const out: string[] = [];
	const skillIds: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';

		if (!isSkillHeaderLine(line)) {
			out.push(line);
			i++;
			continue;
		}

		// Collapse the entire skill block into a single marker line.
		const skillId = parseSkillIdFromHeader(line);
		skillIds.push(skillId);
		out.push(`[Skill:${skillId}]`);

		// Skip until next skill header or end marker.
		i++;
		while (i < lines.length) {
			const next = lines[i] ?? '';
			if (isSkillHeaderLine(next)) break;

			// 兼容：end marker 与用户文本黏连在同一行。
			const remainder = splitSkillEndRemainder(next);
			if (remainder !== null) {
				i++; // consume end marker line
				if (remainder.length > 0) {
					out.push(remainder.replace(/^\s+/, ''));
				}
				break;
			}

			if (isSkillEndLine(next)) {
				i++; // consume end marker
				break;
			}
			i++;
		}
	}

	// Minor cleanup: if we ended up with multiple consecutive blank lines, keep them as-is.
	return {displayText: out.join('\n'), skillIds};
}
