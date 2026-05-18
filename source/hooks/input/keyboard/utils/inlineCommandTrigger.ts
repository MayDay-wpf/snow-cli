export type InlineCommandTrigger = {
	slashIndex: number;
	endIndex: number;
	query: string;
	isAtStart: boolean;
};

type InlineCommandCandidate = {
	name: string;
	type: 'builtin' | 'execute' | 'prompt';
	isCustom?: boolean;
};

function hasWhitespace(text: string): boolean {
	return /\s/.test(text);
}

function hasValidSlashBoundary(text: string, slashIndex: number): boolean {
	if (slashIndex === 0) {
		return true;
	}

	const previous = text[slashIndex - 1] ?? '';
	return /\s/.test(previous);
}

export function findInlineCommandTrigger(
	text: string,
	cursorPosition: number,
): InlineCommandTrigger | null {
	const cursor = Math.max(0, Math.min(cursorPosition, text.length));
	let slashIndex = text.lastIndexOf('/', Math.max(0, cursor - 1));

	while (slashIndex >= 0) {
		if (hasValidSlashBoundary(text, slashIndex)) {
			const query = text.slice(slashIndex + 1, cursor);
			if (!hasWhitespace(query)) {
				return {
					slashIndex,
					endIndex: cursor,
					query,
					isAtStart: slashIndex === 0,
				};
			}
		}

		slashIndex = text.lastIndexOf('/', slashIndex - 1);
	}

	return null;
}

export function isInlineInsertionCommand(
	command: InlineCommandCandidate,
): boolean {
	return command.name === 'gitline' || (command.type === 'prompt' && command.isCustom === true);
}
