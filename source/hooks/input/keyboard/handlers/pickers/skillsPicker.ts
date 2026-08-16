import type {HandlerContext} from '../../types.js';

export function skillsPickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options} = ctx;
	const {
		showSkillsPicker,
		skills,
		skillsSelectedIndex,
		setSkillsSelectedIndex,
		toggleSkillsFocus,
		confirmSkillsSelection,
		handleSkillSelect,
		backspaceSkillsField,
		appendSkillsChar,
		dollarSymbolPosition,
	} = options;

	if (!showSkillsPicker) return false;

	// $ 内联模式（参考子代理 #）：输入直接进入 buffer 实现实时过滤，
	// 只有导航 / 确认由本 handler 接管；命令模式（/skills-）走原有字段编辑逻辑。
	const isInlineMode = dollarSymbolPosition !== -1;

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

	// Tab - 命令模式切换 focus；内联模式没有 search/append 字段，放行给后续 handler
	if (key.tab) {
		if (isInlineMode) return false;
		toggleSkillsFocus();
		return true;
	}

	// Enter - 确认选择
	if (key.return) {
		if (isInlineMode) {
			const selected = skills[skillsSelectedIndex];
			if (selected) {
				handleSkillSelect(selected);
				setSkillsSelectedIndex(0);
			}
		} else {
			confirmSkillsSelection();
		}
		return true;
	}

	// 命令模式：Backspace/Delete 编辑 search/append 字段；
	// 内联模式放行给 deleteAndBackspaceHandler，由 buffer 删除 + forceStateUpdate 自动更新过滤
	if (!isInlineMode && (key.backspace || key.delete)) {
		backspaceSkillsField();
		return true;
	}

	// 命令模式：输入更新字段（支持中文等多字节）
	if (
		!isInlineMode &&
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

	// 内联模式：放行普通输入 / 编辑键，让 regularInput / editing 等处理 buffer
	return isInlineMode ? false : true;
}
