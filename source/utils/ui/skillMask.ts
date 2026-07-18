// Utility to visually hide injected Skill blocks while keeping the raw text intact.
// A "Skill block" is the content inserted by the SkillsPicker (see useSkillsPicker.ts).
//
// Skill 支持在消息任意位置插入，因此 '# Skill:' 标记可能出现在行首或行内
// （前面有用户文本）。本模块在检测时会保留行内标记之前的文本，只折叠标记本身。

export type SkillMaskResult = {
	displayText: string;
	skillIds: string[];
};

/**
 * 在行内查找 '# Skill:' 标记的位置。
 * 返回 '# Skill:' 在 line 中的起始字符索引，未找到返回 -1。
 */
function findSkillHeaderIndex(line: string): number {
	return line.indexOf('# Skill:');
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

/**
 * 从包含 '# Skill:' 的行中解析出 id。
 * 支持行内插入：会先截取 '# Skill:' 起始的子串再解析。
 */
function parseSkillIdFromHeader(line: string): string {
	// Line format: "# Skill: <id>" (可能前面有用户文本)
	const headerIndex = findSkillHeaderIndex(line);
	const headerPart = headerIndex >= 0 ? line.slice(headerIndex) : line;
	return headerPart.replace(/^# Skill:\s*/i, '').trim() || 'unknown';
}

export function maskSkillInjectedText(text: string): SkillMaskResult {
	if (!text) return {displayText: text, skillIds: []};

	const lines = text.split('\n');
	const out: string[] = [];
	const skillIds: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';

		const headerIndex = findSkillHeaderIndex(line);

		if (headerIndex < 0) {
			out.push(line);
			i++;
			continue;
		}

		// 保留 '# Skill:' 之前的用户文本（行内插入场景）
		if (headerIndex > 0) {
			const prefix = line.slice(0, headerIndex).trimEnd();
			if (prefix.length > 0) {
				out.push(prefix);
			}
		}

		// Collapse the entire skill block into a single marker line.
		const skillId = parseSkillIdFromHeader(line);
		skillIds.push(skillId);
		out.push(`[Skill:${skillId}]`);

		// Skip until next skill header or end marker.
		i++;
		while (i < lines.length) {
			const next = lines[i] ?? '';
			if (findSkillHeaderIndex(next) >= 0) break;

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
