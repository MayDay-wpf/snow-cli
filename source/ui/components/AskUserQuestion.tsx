import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import ScrollableSelectInput from './ScrollableSelectInput.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/index.js';

export interface AskUserQuestionResult {
	selected: string;
	customInput?: string;
}

interface Props {
	question: string;
	options: string[];
	onAnswer: (result: AskUserQuestionResult) => void;
}

/**
 * Agent提问组件 - 支持选项选择和自定义输入
 *
 * @description
 * 显示问题和建议选项列表，用户可以：
 * - 直接选择建议选项（回车）
 * - 按'e'键编辑当前高亮选项
 * - 选择「Custom input」从头输入
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
	const [selectedItem, setSelectedItem] = useState<{
		label: string;
		value: string;
	} | null>(null);

	// 缓存回调函数，避免触发ScrollableSelectInput不必要的重渲染
	const handleHighlight = useCallback(
		(item: {label: string; value: string}) => {
			setSelectedItem(item);
		},
		[],
	);

	// Custom input选项的值标识符
	const CUSTOM_INPUT_VALUE = 'custom';

	// 构建选项列表：建议选项 + Custom input
	const items = useMemo(
		() => [
			...options.map((option, index) => ({
				label: option,
				value: `option-${index}`,
			})),
			{
				label: t.askUser.customInputOption,
				value: CUSTOM_INPUT_VALUE,
			},
		],
		[options, t.askUser.customInputOption],
	);

	const handleSelect = useCallback(
		(item: {label: string; value: string}) => {
			if (!hasAnswered) {
				if (item.value === CUSTOM_INPUT_VALUE) {
					setShowCustomInput(true);
				} else {
					setHasAnswered(true);
					onAnswer({
						selected: item.label,
					});
				}
			}
		},
		[hasAnswered, CUSTOM_INPUT_VALUE, onAnswer],
	);

	const handleCustomInputSubmit = useCallback(() => {
		if (!hasAnswered && customInput.trim()) {
			setHasAnswered(true);
			onAnswer({
				selected: t.askUser.customInputLabel,
				customInput: customInput.trim(),
			});
		}
	}, [hasAnswered, customInput, onAnswer, t.askUser.customInputLabel]);

	// 处理'e'键编辑选中选项的逻辑
	useInput(
		input => {
			// Only respond when option list is visible
			if (showCustomInput || hasAnswered) {
				return;
			}

			if (input === 'e' || input === 'E') {
				// 防御性检查：确保有选中项
				if (!selectedItem) return;

				// 切换到自定义输入模式
				setShowCustomInput(true);

				// 根据选项类型预填充内容
				if (selectedItem.value === CUSTOM_INPUT_VALUE) {
					// 「Custom input」选项 - 进入空输入框
					setCustomInput('');
				} else {
					// 建议选项 - 复制内容到输入框
					setCustomInput(selectedItem.label);
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
			</Box>

			<Box marginBottom={1}>
				<Text>{question}</Text>
			</Box>

			{!showCustomInput ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>{t.askUser.selectPrompt}</Text>
					</Box>
					<ScrollableSelectInput
						items={items}
						onSelect={handleSelect}
						onHighlight={handleHighlight}
						isFocused={!showCustomInput}
					/>
					<Box marginTop={1}>
						<Text dimColor>{t.askUser.keyboardHints}</Text>
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
