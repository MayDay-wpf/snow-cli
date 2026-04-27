import type {HandlerContext} from '../../types.js';

export function gitLinePickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showGitLinePicker,
		gitLineCommits,
		setGitLineSelectedIndex,
		toggleGitLineCommitSelection,
		confirmGitLineSelection,
		gitLineSearchQuery,
		setGitLineSearchQuery,
		triggerUpdate,
	} = options;

	if (!showGitLinePicker) return false;

	if (key.upArrow) {
		setGitLineSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, gitLineCommits.length - 1),
		);
		return true;
	}

	if (key.downArrow) {
		const maxIndex = Math.max(0, gitLineCommits.length - 1);
		setGitLineSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	if (input === ' ') {
		toggleGitLineCommitSelection();
		return true;
	}

	if (key.return) {
		confirmGitLineSelection();
		return true;
	}

	if (key.backspace || key.delete) {
		if (gitLineSearchQuery.length > 0) {
			setGitLineSearchQuery(gitLineSearchQuery.slice(0, -1));
			setGitLineSelectedIndex(0);
			triggerUpdate();
		}
		return true;
	}

	if (
		input &&
		!key.ctrl &&
		!key.meta &&
		!key.escape &&
		input !== '\\x1b' &&
		input !== '\\u001b' &&
		!/[\\x00-\\x1F]/.test(input)
	) {
		setGitLineSearchQuery(gitLineSearchQuery + input);
		setGitLineSelectedIndex(0);
		triggerUpdate();
		return true;
	}

	return true;
}
