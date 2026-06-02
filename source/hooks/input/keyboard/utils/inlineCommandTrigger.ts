export type InlineCommandTrigger = {
	slashIndex: number;
	endIndex: number;
	query: string;
	isAtStart: boolean;
};

export type InlineCommandInvocation = InlineCommandTrigger & {
	commandName: string;
	args?: string;
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

		// Avoid getting stuck on the first slash. String.lastIndexOf('/', -1)
		// can still return index 0, which previously caused an infinite loop for
		// inputs like "/help " or "/goal objective" once the command contained whitespace.
		slashIndex = slashIndex > 0 ? text.lastIndexOf('/', slashIndex - 1) : -1;
	}

	return null;
}

export function findInlineCommandInvocation(
	text: string,
	cursorPosition: number,
): InlineCommandInvocation | null {
	const cursor = Math.max(0, Math.min(cursorPosition, text.length));
	let slashIndex = text.lastIndexOf('/', Math.max(0, cursor - 1));

	while (slashIndex >= 0) {
		if (hasValidSlashBoundary(text, slashIndex)) {
			const invocation = text.slice(slashIndex + 1, cursor);
			const commandMatch = invocation.match(/^(\S+)(?:\s+([\s\S]+))?$/);
			if (commandMatch && commandMatch[1]) {
				return {
					slashIndex,
					endIndex: cursor,
					query: commandMatch[1],
					isAtStart: slashIndex === 0,
					commandName: commandMatch[1],
					args: commandMatch[2],
				};
			}
		}

		slashIndex = slashIndex > 0 ? text.lastIndexOf('/', slashIndex - 1) : -1;
	}

	return null;
}

function isNamedInlineCommand(
	command: InlineCommandCandidate,
	names: readonly string[],
): boolean {
	return names.includes(command.name);
}

const INLINE_PICKER_COMMAND_NAMES = ['gitline'] as const;
const INLINE_EXECUTABLE_COMMAND_NAMES = [
	'models',
	'auto-format',
	'simple',
] as const;

export function isInlinePickerCommand(
	command: InlineCommandCandidate,
): boolean {
	return isNamedInlineCommand(command, INLINE_PICKER_COMMAND_NAMES);
}

export function isInlineExecutableCommand(
	command: InlineCommandCandidate,
): boolean {
	return isNamedInlineCommand(command, INLINE_EXECUTABLE_COMMAND_NAMES);
}

export function isInlineTextInsertionCommand(
	command: InlineCommandCandidate,
): boolean {
	return command.type === 'prompt' && command.isCustom === true;
}

export function isInlineCommand(command: InlineCommandCandidate): boolean {
	return (
		isInlinePickerCommand(command) ||
		isInlineExecutableCommand(command) ||
		isInlineTextInsertionCommand(command)
	);
}
