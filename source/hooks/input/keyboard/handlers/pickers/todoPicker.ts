import type {HandlerContext} from '../../types.js';

export function todoPickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showTodoPicker,
		todos,
		setTodoSelectedIndex,
		toggleTodoSelection,
		confirmTodoSelection,
		todoSearchQuery,
		setTodoSearchQuery,
		triggerUpdate,
	} = options;

	if (!showTodoPicker) return false;

	// Up arrow in todo picker - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setTodoSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, todos.length - 1),
		);
		return true;
	}

	// Down arrow in todo picker - 循环导航:最后一项 → 第一项
	if (key.downArrow) {
		const maxIndex = Math.max(0, todos.length - 1);
		setTodoSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Space - toggle selection
	if (input === ' ') {
		toggleTodoSelection();
		return true;
	}

	// Enter - confirm selection
	if (key.return) {
		confirmTodoSelection();
		return true;
	}

	// Backspace - remove last character from search
	if (key.backspace || key.delete) {
		if (todoSearchQuery.length > 0) {
			setTodoSearchQuery(todoSearchQuery.slice(0, -1));
			setTodoSelectedIndex(0); // Reset to first item
			triggerUpdate();
		}
		return true;
	}

	// Type to search - alphanumeric and common characters
	// Accept complete characters (including multi-byte like Chinese)
	// but filter out control sequences and incomplete input
	if (
		input &&
		!key.ctrl &&
		!key.meta &&
		!key.escape &&
		input !== '\x1b' && // Ignore escape sequences
		input !== '\u001b' && // Additional escape check
		!/[\x00-\x1F]/.test(input) // Ignore other control characters
	) {
		setTodoSearchQuery(todoSearchQuery + input);
		setTodoSelectedIndex(0); // Reset to first item
		triggerUpdate();
		return true;
	}

	// For any other key in todo picker, just return to prevent interference
	return true;
}
