import type {HandlerContext} from '../../types.js';

export function skillsPickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showSkillsPicker,
		skills,
		setSkillsSelectedIndex,
		toggleSkillsFocus,
		confirmSkillsSelection,
		backspaceSkillsField,
		appendSkillsChar,
	} = options;

	if (!showSkillsPicker) return false;

	// Up arrow - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setSkillsSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, skills.length - 1),
		);
		return true;
	}

	// Down arrow - 循环导航:最后一项 → 第一项
	if (key.downArrow) {
		const maxIndex = Math.max(0, skills.length - 1);
		setSkillsSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Tab - toggle focus between search/append
	if (key.tab) {
		toggleSkillsFocus();
		return true;
	}

	// Enter - confirm selection
	if (key.return) {
		confirmSkillsSelection();
		return true;
	}

	// Backspace/Delete - remove last character from focused field
	if (key.backspace || key.delete) {
		backspaceSkillsField();
		return true;
	}

	// Type - update focused field (accept multi-byte like Chinese)
	if (
		input &&
		!key.ctrl &&
		!key.meta &&
		!key.escape &&
		input !== '\\x1b' &&
		input !== '\\u001b' &&
		!/[\\x00-\\x1F]/.test(input)
	) {
		appendSkillsChar(input);
		return true;
	}

	return true;
}
