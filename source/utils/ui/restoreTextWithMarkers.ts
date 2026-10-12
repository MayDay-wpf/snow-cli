function parseSkillIdFromHeaderLine(line: string): string {
	return line.replace(/^# Skill:\s*/i, '').trim() || 'unknown';
}

function parseGitLineShaFromHeaderLine(line: string): string {
	return line.replace(/^# GitLine:\s*/i, '').trim() || 'unknown';
}

export function restoreTextWithSkillPlaceholders(
	buffer: {
		insertRestoredText: (t: string) => void;
		insertTextPlaceholder: (c: string, p: string) => void;
	},
	text: string,
) {
	if (!text) return;

	const lines = text.split('\n');
	let plain = '';
	let rollbackPasteCounter = 0;

	const insertPlainOrPastePlaceholder = (chunk: string) => {
		if (!chunk) return;
		const lineCount = chunk.split('\n').length;
		const shouldMaskAsPaste = chunk.length >= 400 || lineCount >= 12;
		if (!shouldMaskAsPaste) {
			buffer.insertRestoredText(chunk);
			return;
		}

		rollbackPasteCounter++;
		buffer.insertTextPlaceholder(
			chunk,
			`[Paste ${lineCount} lines #${rollbackPasteCounter}] `,
		);
	};

	const flushPlain = () => {
		if (!plain) return;
		insertPlainOrPastePlaceholder(plain);
		plain = '';
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? '';
		const isSkillBlock = line.startsWith('# Skill:');
		const isGitLineBlock = line.startsWith('# GitLine:');
		const isPasteBlock = line.startsWith('# Paste:');
		if (!isSkillBlock && !isGitLineBlock && !isPasteBlock) {
			plain += line;
			if (i < lines.length - 1) plain += '\n';
			i++;
			continue;
		}

		flushPlain();

		if (isPasteBlock) {
			// Collect paste content until # Paste End
			const pasteLines: string[] = [];
			i++;
			while (i < lines.length) {
				const next = lines[i] ?? '';
				if (next.trimStart().startsWith('# Paste End')) {
					i++;
					break;
				}
				pasteLines.push(next);
				i++;
			}
			const pasteContent = pasteLines.join('\n');
			if (pasteContent) {
				const lineCount = pasteLines.length;
				rollbackPasteCounter++;
				buffer.insertTextPlaceholder(
					pasteContent,
					`[Paste ${lineCount} lines #${rollbackPasteCounter}] `,
				);
			}
			continue;
		}

		const rawLines: string[] = [line];
		const placeholderText = isSkillBlock
			? `[Skill:${parseSkillIdFromHeaderLine(line)}] `
			: `[GitLine:${parseGitLineShaFromHeaderLine(line).slice(0, 8)}] `;
		const endMarker = isSkillBlock ? '# Skill End' : '# GitLine End';
		let endFound = false;
		i++;

		while (i < lines.length) {
			const next = lines[i] ?? '';
			if (next.startsWith('# Skill:') || next.startsWith('# GitLine:')) break;

			const trimmedStart = next.trimStart();
			if (trimmedStart.startsWith(endMarker)) {
				const remainder = trimmedStart.slice(endMarker.length);
				rawLines.push(endMarker);
				endFound = true;
				i++;

				if (remainder.length > 0) {
					plain += remainder.replace(/^\s+/, '');
					if (i < lines.length) plain += '\n';
				}
				break;
			}

			rawLines.push(next);
			i++;
		}

		let raw = rawLines.join('\n');
		if (endFound && !raw.endsWith('\n')) raw += '\n';

		buffer.insertTextPlaceholder(raw, placeholderText);
	}

	flushPlain();
}
