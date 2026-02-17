import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';

export interface AskUserQuestionResult {
	selected: string | string[];
	customInput?: string;
	cancelled?: boolean;
}

interface Props {
	question: string;
	options: string[];
	onAnswer: (result: AskUserQuestionResult) => void;
	onCancel?: () => void;
}

/**
 * Agent提问组件 - 支持选项选择、多选和自定义输入
 *
 * @description
 * 显示问题和建议选项列表，用户可以：
 * - 直接选择建议选项（回车确认单个高亮项）
 * - 按空格键切换选项勾选状态（可多选）
 * - 按'e'键编辑当前高亮选项
 * - 选择「Custom input」从头输入
 * - 数字键快速切换选项勾选状态
 *
 * @param question - 要问用户的问题
 * @param options - 建议选项数组
 * @param onAnswer - 用户回答后的回调函数
 */
export default function AskUserQuestion({question, options, onAnswer}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [hasAnswered, setHasAnswered] = useState(false);
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [customInput, setCustomInput] = useState('');
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());
	// 动态选项列表，支持添加自定义输入
	const [dynamicOptions, setDynamicOptions] = useState<string[]>([]);

	//Custom input选项的值标识符
	const CUSTOM_INPUT_VALUE = 'custom';
	//Cancel选项的值标识符
	const CANCEL_VALUE = 'cancel';

	//构建选项列表：建议选项 + 动态添加的选项 + Custom input + Cancel
	//防御性检查：确保 options 是数组
	const safeOptions = Array.isArray(options) ? options : [];
	const allOptions = [...safeOptions, ...dynamicOptions];
	const items = useMemo(
		() => [
			...allOptions.map((option, index) => ({
				label: option,
				value: `option-${index}`,
				index,
			})),
			{
				label: t.askUser.customInputOption,
				value: CUSTOM_INPUT_VALUE,
				index: -1,
			},
			{
				label: t.askUser.cancelOption || 'Cancel',
				value: CANCEL_VALUE,
				index: -2,
			},
		],
		[allOptions, t.askUser.customInputOption, t.askUser.cancelOption],
	);

	const handleSubmit = useCallback(() => {
		if (hasAnswered) return;

		const currentItem = items[highlightedIndex];
		if (!currentItem) return;

		if (currentItem.value === CUSTOM_INPUT_VALUE) {
			setShowCustomInput(true);
			return;
		}

		// 处理取消选项
		if (currentItem.value === CANCEL_VALUE) {
			setHasAnswered(true);
			onAnswer({
				selected: '',
				cancelled: true,
			});
			return;
		}

		// 始终支持多选：如果有勾选项则返回数组，否则返回当前高亮项（单个）
		const selectedOptions = Array.from(checkedIndices)
			.sort((a, b) => a - b)
			.map(idx => allOptions[idx] as string)
			.filter(Boolean);

		setHasAnswered(true);

		if (selectedOptions.length > 0) {
			// 有勾选项，返回数组
			onAnswer({
				selected: selectedOptions,
			});
		} else {
			// 没有勾选项，返回当前高亮项（单个）
			onAnswer({
				selected: currentItem.label,
			});
		}
	}, [
		hasAnswered,
		items,
		highlightedIndex,
		checkedIndices,
		allOptions,
		onAnswer,
	]);

	const handleCustomInputSubmit = useCallback(() => {
		if (customInput.trim()) {
			// 将自定义输入添加到动态选项列表中
			const newOption = customInput.trim();
			if (!allOptions.includes(newOption)) {
				setDynamicOptions(prev => [...prev, newOption]);
			}
			// 回到选择页面
			setShowCustomInput(false);
			setCustomInput('');
			// 高亮新添加的选项
			const newIndex = allOptions.length; // 新选项会在下次渲染时出现在这个位置
			setHighlightedIndex(newIndex);
		}
	}, [customInput, allOptions]);

	const toggleCheck = useCallback((index: number) => {
		// 不允许勾选特殊选项
		if (index < 0) return;

		setCheckedIndices(prev => {
			const newSet = new Set(prev);
			if (newSet.has(index)) {
				newSet.delete(index);
			} else {
				newSet.add(index);
			}
			return newSet;
		});
	}, []);

	//处理键盘输入
	useInput(
		(input, key) => {
			if (showCustomInput || hasAnswered) {
				return;
			}

			//上下键导航
			if (key.upArrow || input === 'k') {
				setHighlightedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
				return;
			}
			if (key.downArrow || input === 'j') {
				setHighlightedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
				return;
			}

			//空格键切换选中（始终支持多选）
			if (input === ' ') {
				const currentItem = items[highlightedIndex];
				if (
					currentItem &&
					currentItem.value !== CUSTOM_INPUT_VALUE &&
					currentItem.value !== CANCEL_VALUE
				) {
					toggleCheck(currentItem.index);
				}
				return;
			}

			//数字键快速切换选项勾选状态
			const num = parseInt(input, 10);
			if (!isNaN(num) && num >= 1 && num <= allOptions.length) {
				const idx = num - 1;
				toggleCheck(idx);
				return;
			}

			//回车确认
			if (key.return) {
				handleSubmit();
				return;
			}

			//ESC键取消
			if (key.escape) {
				setHasAnswered(true);
				onAnswer({
					selected: '',
					cancelled: true,
				});
				return;
			}

			//e键编辑
			if (input === 'e' || input === 'E') {
				const currentItem = items[highlightedIndex];
				if (!currentItem) return;

				setShowCustomInput(true);

				if (currentItem.value === CUSTOM_INPUT_VALUE) {
					setCustomInput('');
				} else {
					setCustomInput(currentItem.label);
				}
			}
		},
		{isActive: !showCustomInput && !hasAnswered},
	);

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginY={1}
			borderStyle={'round'}
			borderColor={theme.colors.menuInfo}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.askUser.header}
				</Text>
				<Text dimColor> ({t.askUser.multiSelectHint || '可多选'})</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>{question}</Text>
			</Box>

			{!showCustomInput ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>{t.askUser.selectPrompt}</Text>
					</Box>
					<Box flexDirection="column">
						{items.map((item, index) => {
							const isHighlighted = index === highlightedIndex;
							const isChecked =
								item.index >= 0 && checkedIndices.has(item.index);
							const isCustomInput = item.value === CUSTOM_INPUT_VALUE;
							const isCancel = item.value === CANCEL_VALUE;

							return (
								<Box key={item.value}>
									<Text
										color={isHighlighted ? theme.colors.menuInfo : undefined}
									>
										{isHighlighted ? '▸ ' : '  '}
									</Text>
									{!isCustomInput && !isCancel && (
										<Text
											color={isChecked ? theme.colors.success : undefined}
											dimColor={!isChecked}
										>
											{isChecked ? '[✓] ' : '[ ] '}
										</Text>
									)}
									<Text
										color={isHighlighted ? theme.colors.menuInfo : undefined}
										dimColor={!isHighlighted}
									>
										{item.index >= 0 ? `${item.index + 1}. ` : ''}
										{item.label}
									</Text>
								</Box>
							);
						})}
					</Box>
					<Box marginTop={1}>
						<Text dimColor>
							{t.askUser.multiSelectKeyboardHints ||
								'↑↓ 移动 | 空格 切换 | 1-9 快速切换 | 回车 确认 | e 编辑'}
						</Text>
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>{t.askUser.enterResponse}</Text>
					</Box>
					<Box>
						<Text color={theme.colors.success}>&gt; </Text>
						<TextInput
							value={customInput}
							onChange={setCustomInput}
							onSubmit={handleCustomInputSubmit}
						/>
					</Box>
				</Box>
			)}
		</Box>
	);
}
