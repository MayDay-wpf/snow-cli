import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';

export interface AskUserQuestionResult {
	selected: string | string[];
	customInput?: string;
}

interface Props {
	question: string;
	options: string[];
	multiSelect?: boolean;
	onAnswer: (result: AskUserQuestionResult) => void;
}

/**
 * Agent提问组件 - 支持选项选择、多选和自定义输入
 *
 * @description
 * 显示问题和建议选项列表，用户可以：
 * - 直接选择建议选项（回车）
 * - 按'e'键编辑当前高亮选项
 * - 选择「Custom input」从头输入
 * - 多选模式下按空格切换选项
 *
 * @param question - 要问用户的问题
 * @param options - 建议选项数组
 * @param multiSelect - 是否启用多选模式
 * @param onAnswer - 用户回答后的回调函数
 */
export default function AskUserQuestion({question, options, multiSelect = false, onAnswer}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [hasAnswered, setHasAnswered] = useState(false);
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [customInput, setCustomInput] = useState('');
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());

	//Custom input选项的值标识符
	const CUSTOM_INPUT_VALUE = 'custom';

	//构建选项列表：建议选项 + Custom input
	const items = useMemo(
		() => [
			...options.map((option, index) => ({
				label: option,
				value: `option-${index}`,
				index,
			})),
			{
				label: t.askUser.customInputOption,
				value: CUSTOM_INPUT_VALUE,
				index: -1,
			},
		],
		[options, t.askUser.customInputOption],
	);

	const handleSubmit = useCallback(() => {
		if (hasAnswered) return;

		const currentItem = items[highlightedIndex];
		if (!currentItem) return;

		if (currentItem.value === CUSTOM_INPUT_VALUE) {
			setShowCustomInput(true);
			return;
		}

		if (multiSelect) {
			//多选模式：返回所有选中的选项
			const selectedOptions = Array.from(checkedIndices)
				.sort((a, b) => a - b)
				.map(idx => options[idx] as string)
				.filter(Boolean);

			if (selectedOptions.length === 0) {
				//如果没有勾选，则使用当前高亮项
				selectedOptions.push(currentItem.label);
			}

			setHasAnswered(true);
			onAnswer({
				selected: selectedOptions,
			});
		} else {
			//单选模式
			setHasAnswered(true);
			onAnswer({
				selected: currentItem.label,
			});
		}
	}, [hasAnswered, items, highlightedIndex, multiSelect, checkedIndices, options, onAnswer]);

	const handleCustomInputSubmit = useCallback(() => {
		if (!hasAnswered && customInput.trim()) {
			setHasAnswered(true);
			onAnswer({
				selected: t.askUser.customInputLabel,
				customInput: customInput.trim(),
			});
		}
	}, [hasAnswered, customInput, onAnswer, t.askUser.customInputLabel]);

	const toggleCheck = useCallback((index: number) => {
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

			//空格键切换选中（多选模式）
			if (input === ' ' && multiSelect) {
				const currentItem = items[highlightedIndex];
				if (currentItem && currentItem.value !== CUSTOM_INPUT_VALUE) {
					toggleCheck(currentItem.index);
				}
				return;
			}

			//数字键快速选择/切换
			const num = parseInt(input, 10);
			if (!isNaN(num) && num >= 1 && num <= options.length) {
				const idx = num - 1;
				if (multiSelect) {
					toggleCheck(idx);
				} else {
					setHasAnswered(true);
					onAnswer({
						selected: options[idx] as string,
					});
				}
				return;
			}

			//回车确认
			if (key.return) {
				handleSubmit();
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
				{multiSelect && (
					<Text dimColor> ({t.askUser.multiSelectHint || '多选模式'})</Text>
				)}
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
							const isChecked = item.index >= 0 && checkedIndices.has(item.index);
							const isCustomInput = item.value === CUSTOM_INPUT_VALUE;

							return (
								<Box key={item.value}>
									<Text color={isHighlighted ? theme.colors.menuInfo : undefined}>
										{isHighlighted ? '▸ ' : '  '}
									</Text>
									{multiSelect && !isCustomInput && (
										<Text color={isChecked ? theme.colors.success : undefined} dimColor={!isChecked}>
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
							{multiSelect
								? (t.askUser.multiSelectKeyboardHints || '↑↓ 移动 | 空格 切换 | 1-9 快速切换 | 回车 确认 | e 编辑')
								: t.askUser.keyboardHints}
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
