// Utility to visually hide injected GitLine blocks while keeping the raw text intact.
// A "GitLine block" is the content inserted by the GitLine picker (see useGitLinePicker.ts).
//
// Injected format (two variants):
//
//   # GitLine: <sha>
//   Commit: <sha>
//   Author: <name>
//   Date: <iso>
//   Subject: <subject>
//
//   ```git
//   <patch>
//   ```
//   # GitLine End
//
//   # GitLine: staged
//   Type: staged
//   Files: <n>
//
//   ```git
//   <patch>
//   ```
//   # GitLine End
//
// This module collapses each block into a single `[GitLine:<id>]` marker line so the
// terminal UI stays compact. The original message.content is never modified — only the
// display text is affected, preserving request-body / persistence / copy integrity.
//
// GitLine 支持在消息任意位置插入，因此 '# GitLine:' 标记可能出现在行首或行内
// （前面有用户文本）。本模块在检测时会保留行内标记之前的文本，只折叠标记本身。

export type GitLineMaskResult = {
	displayText: string;
	gitLineIds: string[];
};

/**
 * 在行内查找 '# GitLine:' 标记的位置。
 * 返回 '# GitLine:' 在 line 中的起始字符索引，未找到返回 -1。
 */
function findGitLineHeaderIndex(line: string): number {
	return line.indexOf('# GitLine:');
}

function isGitLineEndLine(line: string): boolean {
	return line.trim() === '# GitLine End';
}

// 兼容历史消息中 end marker 与后续文本黏连在同一行的情况：
// "# GitLine End<user text>"。返回 end marker 之后的剩余文本，否则 null。
function splitGitLineEndRemainder(line: string): string | null {
	const trimmed = line.trimStart();
	if (!trimmed.startsWith('# GitLine End')) return null;
	return trimmed.slice('# GitLine End'.length);
}

/**
 * 从包含 '# GitLine:' 的行中解析出 id。
 * 支持行内插入：会先截取 '# GitLine:' 起始的子串再解析。
 */
function parseGitLineIdFromHeader(line: string): string {
	// Line format: "# GitLine: <id>" (可能前面有用户文本)
	const headerIndex = findGitLineHeaderIndex(line);
	const headerPart = headerIndex >= 0 ? line.slice(headerIndex) : line;
	// Line format: "# GitLine: <id>"
	const id = headerPart.replace(/^# GitLine:\s*/i, '').trim() || 'unknown';
	// 与输入框标签格式保持一致：sha 取前 8 位，staged 保持原样。
	return id.slice(0, 8);
}

export function maskGitLineText(text: string): GitLineMaskResult {
	if (!text) return {displayText: text, gitLineIds: []};

	const lines = text.split('\n');
	const out: string[] = [];
	const gitLineIds: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';

		const headerIndex = findGitLineHeaderIndex(line);

		if (headerIndex < 0) {
			out.push(line);
			i++;
			continue;
		}

		// 保留 '# GitLine:' 之前的用户文本（行内插入场景）
		if (headerIndex > 0) {
			const prefix = line.slice(0, headerIndex).trimEnd();
			if (prefix.length > 0) {
				out.push(prefix);
			}
		}

		// Collapse the entire GitLine block into a single marker line.
		const gitLineId = parseGitLineIdFromHeader(line);
		gitLineIds.push(gitLineId);
		out.push(`[GitLine:${gitLineId}]`);

		// Skip until the end marker.
		i++;
		while (i < lines.length) {
			const next = lines[i] ?? '';

			// 遇到新的 GitLine 头部，提前结束当前块（容错：缺失 end marker）。
			if (findGitLineHeaderIndex(next) >= 0) break;

			// 兼容：end marker 与用户文本黏连在同一行。
			const remainder = splitGitLineEndRemainder(next);
			if (remainder !== null) {
				i++; // consume end marker line
				if (remainder.length > 0) {
					out.push(remainder.replace(/^\s+/, ''));
				}
				break;
			}

			if (isGitLineEndLine(next)) {
				i++; // consume end marker
				// 消费 end marker 之后紧邻的空行（注入格式会带一个尾随空行），
				// 避免回显时出现多余空行。
				if (i < lines.length && (lines[i] ?? '').trim() === '') {
					i++;
				}
				break;
			}

			i++;
		}
	}

	return {displayText: out.join('\n'), gitLineIds};
}
