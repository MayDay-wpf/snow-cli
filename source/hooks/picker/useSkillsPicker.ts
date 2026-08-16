import {useCallback, useEffect, useMemo, useState} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import type {Skill} from '../../mcp/skills.js';

export type SkillsPickerFocus = 'search' | 'append';

function buildInjectedSkillText(skill: Skill, appendText: string): string {
	const append = appendText.trim();
	const skillBody = skill.content.trim();

	// If the skill markdown provides an $ARGUMENTS placeholder, fill it in.
	// Otherwise keep the legacy behavior (append a separate [User Append] block).
	if (skillBody.includes('$ARGUMENTS')) {
		const replaced = skillBody.split('$ARGUMENTS').join(append);
		return `# Skill: ${skill.id}\n\n${replaced}`.trim();
	}

	const appendBlock = append ? `\n\n[User Append]\n${append}\n` : '';

	// Keep it plain text; the actual skill prompt is markdown.
	return `# Skill: ${skill.id}\n\n${skillBody}${appendBlock}`.trim();
}

export function useSkillsPicker(buffer: TextBuffer, triggerUpdate: () => void) {
	const [showSkillsPicker, setShowSkillsPicker] = useState(false);
	const [skillsSelectedIndex, setSkillsSelectedIndex] = useState(0);
	const [allSkills, setAllSkills] = useState<Skill[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');
	const [appendText, setAppendText] = useState('');
	const [focus, setFocus] = useState<SkillsPickerFocus>('search');
	const [originalTextBeforeOpen, setOriginalTextBeforeOpen] = useState('');
	// $ 内联触发状态（参考子代理 # 触发原理）：
	// dollarSymbolPosition 记录光标前最后一个有效 $ 的位置（-1 表示未激活），
	// inlineQuery 是 $ 后到光标的过滤文本，随输入实时变化。
	const [dollarSymbolPosition, setDollarSymbolPosition] = useState(-1);
	const [inlineQuery, setInlineQuery] = useState('');

	const filteredSkills = useMemo(() => {
		// 内联模式用 $ 后的文本过滤，命令模式用 searchQuery 过滤
		const q = (dollarSymbolPosition !== -1 ? inlineQuery : searchQuery)
			.trim()
			.toLowerCase();
		if (!q) return allSkills;
		return allSkills.filter(skill => {
			return (
				skill.id.toLowerCase().includes(q) ||
				skill.name.toLowerCase().includes(q) ||
				skill.description.toLowerCase().includes(q)
			);
		});
	}, [allSkills, searchQuery, dollarSymbolPosition, inlineQuery]);

	// Load skills when picker is shown.
	useEffect(() => {
		if (!showSkillsPicker) return;

		setIsLoading(true);
		setSearchQuery('');
		setAppendText('');
		setFocus('search');
		setSkillsSelectedIndex(0);
		setOriginalTextBeforeOpen(buffer.getFullText());

		// Let UI render loading state first.
		setTimeout(() => {
			import('../../mcp/skills.js')
				.then(async m => m.listAvailableSkills(process.cwd()))
				.then(list => {
					setAllSkills(list);
					setIsLoading(false);
				})
				.catch(error => {
					console.error('Failed to load skills:', error);
					setAllSkills([]);
					setIsLoading(false);
				});
		}, 0);
	}, [showSkillsPicker, buffer]);

	const closeSkillsPicker = useCallback(() => {
		setShowSkillsPicker(false);
		setSkillsSelectedIndex(0);
		setSearchQuery('');
		setAppendText('');
		setFocus('search');
		setDollarSymbolPosition(-1);
		setInlineQuery('');
		triggerUpdate();
	}, [triggerUpdate]);

	/**
	 * 基于 $ 符号实时更新 skills picker 状态（参考子代理 # 触发原理）。
	 * 输入 / 移动光标 / 换行 / 退格等操作后都会调用：
	 * - 光标前最后一个有效 $（其后到光标无空格/换行）→ 打开面板并提取过滤词
	 * - $ 前是 @ 或 #（分别属于文件选择器 / 子代理选择器领域）→ 不激活
	 * - $ 消失或其后出现空白 → 自动关闭面板
	 */
	const updateSkillsPickerState = useCallback(
		(_text: string, cursorPos: number) => {
			// 使用显示文本（带占位符）而不是完整文本（展开后），与子代理 # 一致
			const displayText = buffer.text;

			// 查找光标前的最后一个 $ 符号
			const beforeCursor = displayText.slice(0, cursorPos);

			let position = -1;
			let query = '';

			// 从光标位置向前搜索 $
			for (let i = beforeCursor.length - 1; i >= 0; i--) {
				if (beforeCursor[i] === '$') {
					// $ 前是 @（文件选择器领域）或 #（子代理选择器领域），不激活 skills picker
					if (
						i > 0 &&
						(beforeCursor[i - 1] === '@' || beforeCursor[i - 1] === '#')
					) {
						position = -1;
						break;
					}
					position = i;
					const afterDollar = beforeCursor.slice(i + 1);
					// 仅当 $ 后无空格/换行时激活（过滤词即为 $ 后的文本）
					if (!afterDollar.includes(' ') && !afterDollar.includes('\n')) {
						query = afterDollar;
						break;
					} else {
						// $ 后有空白，无效
						position = -1;
						break;
					}
				}
			}

			if (position !== -1) {
				// 找到有效的 $ 上下文
				if (
					!showSkillsPicker ||
					dollarSymbolPosition !== position ||
					inlineQuery !== query
				) {
					setShowSkillsPicker(true);
					setDollarSymbolPosition(position);
					setInlineQuery(query);
					setSkillsSelectedIndex(0);
				}
			} else {
				// 没有有效的 $ 上下文且面板由 $ 触发 → 隐藏
				if (showSkillsPicker && dollarSymbolPosition !== -1) {
					setShowSkillsPicker(false);
					setDollarSymbolPosition(-1);
					setInlineQuery('');
					setSkillsSelectedIndex(0);
				}
			}
		},
		[buffer, showSkillsPicker, dollarSymbolPosition, inlineQuery],
	);

	const toggleFocus = useCallback(() => {
		setFocus(prev => (prev === 'search' ? 'append' : 'search'));
		triggerUpdate();
	}, [triggerUpdate]);

	const appendChar = useCallback(
		(ch: string) => {
			if (!ch) return;
			if (focus === 'search') {
				setSearchQuery(prev => prev + ch);
				setSkillsSelectedIndex(0);
			} else {
				setAppendText(prev => prev + ch);
			}
			triggerUpdate();
		},
		[focus, triggerUpdate],
	);

	const backspace = useCallback(() => {
		if (focus === 'search') {
			setSearchQuery(prev => (prev.length > 0 ? prev.slice(0, -1) : prev));
			setSkillsSelectedIndex(0);
		} else {
			setAppendText(prev => (prev.length > 0 ? prev.slice(0, -1) : prev));
		}
		triggerUpdate();
	}, [focus, triggerUpdate]);

	const confirmSelection = useCallback(async () => {
		if (isLoading) return;
		if (filteredSkills.length === 0) {
			closeSkillsPicker();
			return;
		}

		const selected = filteredSkills[skillsSelectedIndex];
		if (!selected) {
			closeSkillsPicker();
			return;
		}

		const injected = buildInjectedSkillText(selected, appendText);
		// 结束标记：用于让 display-only mask 只折叠注入块本身。
		// 注意：必须以换行结尾，否则用户在占位符后继续输入时会与 "# Skill End" 黏连，
		// 导致 mask 无法识别 end marker，从而把用户输入也一并折叠掉。
		const injectedWithEndMarker = `${injected}\n# Skill End\n`;
		const original = originalTextBeforeOpen.trim();

		buffer.setText('');
		if (original) {
			buffer.insert(original);
			buffer.insert('\n\n');
		}

		// 视觉层只显示占位符，但发送时通过 buffer.getFullText() 仍会还原完整注入块。
		// 注意：末尾空格用于让用户继续输入时视觉上分隔开。
		buffer.insertTextPlaceholder(
			injectedWithEndMarker,
			`[Skill:${selected.id}] `,
		);

		setShowSkillsPicker(false);
		setSkillsSelectedIndex(0);
		setSearchQuery('');
		setAppendText('');
		setFocus('search');
		triggerUpdate();
	}, [
		appendText,
		buffer,
		closeSkillsPicker,
		filteredSkills,
		isLoading,
		originalTextBeforeOpen,
		skillsSelectedIndex,
		triggerUpdate,
	]);

	/**
	 * $ 内联触发模式下确认选择：用 skill 注入块替换光标前的 $query 文本。
	 * 保留 $ 前的输入内容，并在占位符后插入光标后的文本，光标停占位符末尾。
	 * 命令模式（dollarSymbolPosition === -1）回退到原有整块注入逻辑 confirmSelection。
	 */
	const handleSkillSelect = useCallback(
		(skill: Skill) => {
			if (dollarSymbolPosition === -1) {
				// 命令面板触发：沿用原有注入行为
				confirmSelection();
				return;
			}
			if (isLoading) return;
			if (!skill) {
				closeSkillsPicker();
				return;
			}

			const injected = buildInjectedSkillText(skill, '');
			// 结束标记：用于让 display-only mask 只折叠注入块本身
			const injectedWithEndMarker = `${injected}\n# Skill End\n`;
			const placeholderText = `[Skill:${skill.id}] `;

			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const beforeDollar = displayText.slice(0, dollarSymbolPosition);
			const afterCursor = displayText.slice(cursorPos);

			// 重建 buffer：保留 $ 前文本，注入 skill 块（视觉层只显示占位符），再接光标后文本
			buffer.setText(beforeDollar);
			buffer.insertTextPlaceholder(injectedWithEndMarker, placeholderText);
			if (afterCursor) {
				buffer.insert(afterCursor);
			}

			// 光标停在占位符之后，方便用户继续输入
			const targetPos = beforeDollar.length + placeholderText.length;
			buffer.setCursorPosition(0);
			for (let i = 0; i < targetPos; i++) {
				if (i < buffer.text.length) {
					buffer.moveRight();
				}
			}

			setShowSkillsPicker(false);
			setDollarSymbolPosition(-1);
			setInlineQuery('');
			setSkillsSelectedIndex(0);
			triggerUpdate();
		},
		[
			buffer,
			confirmSelection,
			closeSkillsPicker,
			dollarSymbolPosition,
			isLoading,
			triggerUpdate,
		],
	);

	return {
		showSkillsPicker,
		setShowSkillsPicker,
		skillsSelectedIndex,
		setSkillsSelectedIndex,
		skills: filteredSkills,
		isLoading,
		searchQuery,
		appendText,
		focus,
		toggleFocus,
		appendChar,
		backspace,
		confirmSelection,
		closeSkillsPicker,
		// $ 内联触发相关
		dollarSymbolPosition,
		inlineQuery,
		updateSkillsPickerState,
		handleSkillSelect,
	};
}
