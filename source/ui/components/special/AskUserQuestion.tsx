import React, {useState, useCallback, useMemo, useEffect} from 'react';
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
	multiSelect?: boolean;
	onAnswer: (result: AskUserQuestionResult) => void;
	onCancel?: () => void;
}

/** 选项列表可视行数；超出部分随高亮项用方向键滚动 */
const VISIBLE_OPTION_ROWS = 5;
/** 非焦点选项的最大显示长度，避免列表高度抖动 */
const NON_FOCUSED_OPTION_MAX_LEN = 20;

/**
 * Agent提问组件 - 支持单选、多选和自定义输入
 *
 * @description
 * 显示问题和建议选项列表，用户可以：
 * - 单选模式：回车直接选中高亮项提交
 * - 多选模式：回车/空格切换勾选，Tab/下方向键切换到底部「确认提交」按回车提交
 * - 按'e'键编辑当前高亮选项
 * - 选择「Custom input」从头输入
 * - 数字键快速选中/切换选项
 *
 * @param question - 要问用户的问题
 * @param options - 建议选项数组
 * @param multiSelect - 是否允许多选，默认 false
 * @param onAnswer - 用户回答后的回调函数
 */
export default function AskUserQuestion({
	question,
	options,
	multiSelect = false,
	onAnswer,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [hasAnswered, setHasAnswered] = useState(false);
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [customInput, setCustomInput] = useState('');
	const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(0);
	const [cursorMode, setCursorMode] = useState<
		'options' | 'submit' | 'custom' | 'cancel'
	>('options');
	const [checkedIndices, setCheckedIndices] = useState<Set<number>>(new Set());
	const [submitWarning, setSubmitWarning] = useState<string | null>(null);
	// 动态选项列表，支持添加自定义输入
	const [dynamicOptions, setDynamicOptions] = useState<string[]>([]);

	//构建选项列表：建议选项 + 动态添加的选项
	//防御性检查：确保 options 是数组
	const safeOptions = Array.isArray(options) ? options : [];
	const allOptions = [...safeOptions, ...dynamicOptions];
	const optionItems = useMemo(
		() =>
			allOptions.map((option, index) => ({
				label: option,
				value: `option-${index}`,
				index,
			})),
		[allOptions],
	);

	useEffect(() => {
		if (optionItems.length === 0 && cursorMode === 'options') {
			setCursorMode('custom');
			return;
		}

		if (optionItems.length > 0 && highlightedOptionIndex >= optionItems.length) {
			setHighlightedOptionIndex(optionItems.length - 1);
		}
	}, [optionItems.length, highlightedOptionIndex, cursorMode]);

	// 与 MCPInfoPanel 相同的居中视口，避免高亮始终在窗口边缘
	const optionDisplayWindow = useMemo(() => {
		const total = optionItems.length;
		if (total <= VISIBLE_OPTION_ROWS) {
			return {
				windowItems: optionItems,
				startIndex: 0,
				endIndex: total,
				hiddenAbove: 0,
				hiddenBelow: 0,
			};
		}

		const halfWindow = Math.floor(VISIBLE_OPTION_ROWS / 2);
		let startIndex = Math.max(0, highlightedOptionIndex - halfWindow);
		const endIndex = Math.min(
			total,
			startIndex + VISIBLE_OPTION_ROWS,
		);

		if (endIndex - startIndex < VISIBLE_OPTION_ROWS) {
			startIndex = Math.max(0, endIndex - VISIBLE_OPTION_ROWS);
		}

		return {
			windowItems: optionItems.slice(startIndex, endIndex),
			startIndex,
			endIndex,
			hiddenAbove: startIndex,
			hiddenBelow: total - endIndex,
		};
	}, [optionItems, highlightedOptionIndex]);

	const optionListScrollable = optionItems.length > VISIBLE_OPTION_ROWS;
	const formatOptionLabel = useCallback((label: string, isHighlighted: boolean) => {
		if (isHighlighted || label.length <= NON_FOCUSED_OPTION_MAX_LEN) {
			return label;
		}

		return `${label.slice(0, NON_FOCUSED_OPTION_MAX_LEN - 3)}...`;
	}, []);

	const handleSubmit = useCallback(() => {
		if (hasAnswered) return;

		if (cursorMode === 'custom') {
			setShowCustomInput(true);
			setSubmitWarning(null);
			return;
		}

		if (cursorMode === 'cancel') {
			setHasAnswered(true);
			onAnswer({
				selected: '',
				cancelled: true,
			});
			return;
		}

		if (cursorMode === 'submit') {
			const selectedOptions = Array.from(checkedIndices)
				.sort((a, b) => a - b)
				.map(idx => allOptions[idx] as string)
				.filter(Boolean);

			if (selectedOptions.length === 0) {
				setSubmitWarning('请至少选择一项 / Please select at least one item');
				return;
			}

			setHasAnswered(true);
			onAnswer({
				selected: selectedOptions,
			});
			return;
		}

		const currentItem = optionItems[highlightedOptionIndex];
		if (!currentItem) return;

		if (multiSelect) {
			// 多选模式下：在选项行按回车是切换勾选状态，不直接提交
			setCheckedIndices(prev => {
				const newSet = new Set(prev);
				if (newSet.has(currentItem.index)) {
					newSet.delete(currentItem.index);
				} else {
					newSet.add(currentItem.index);
				}
				return newSet;
			});
			setSubmitWarning(null);
		} else {
			// 单选模式：在选项行按回车立即以单值提交退出
			setHasAnswered(true);
			onAnswer({
				selected: currentItem.label,
			});
		}
	}, [
		hasAnswered,
		cursorMode,
		multiSelect,
		optionItems,
		highlightedOptionIndex,
		checkedIndices,
		allOptions,
		onAnswer,
	]);

	const handleCustomInputSubmit = useCallback(() => {
		if (customInput.trim()) {
			const newOption = customInput.trim();
			if (!allOptions.includes(newOption)) {
				setDynamicOptions(prev => [...prev, newOption]);
			}
			setShowCustomInput(false);
			setCustomInput('');
			const newIndex = allOptions.length;
			setHighlightedOptionIndex(newIndex);
			setCursorMode('options');
			if (multiSelect) {
				setCheckedIndices(prev => new Set(prev).add(newIndex));
			}
			setSubmitWarning(null);
		}
	}, [customInput, allOptions, multiSelect]);

	const handleCustomInputCancel = useCallback(() => {
		setShowCustomInput(false);
		setCustomInput('');
	}, []);

	const toggleCheck = useCallback((index: number) => {
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
		setSubmitWarning(null);
	}, []);

	// 处理键盘输入 - 选择列表模式
	useInput(
		(input, key) => {
			if (showCustomInput || hasAnswered) {
				return;
			}

			// 快捷快捷键：Ctrl+Enter 在多选模式下直接提交
			if (multiSelect && key.ctrl && key.return) {
				const selectedOptions = Array.from(checkedIndices)
					.sort((a, b) => a - b)
					.map(idx => allOptions[idx] as string)
					.filter(Boolean);

				if (selectedOptions.length === 0) {
					setSubmitWarning('请至少选择一项 / Please select at least one item');
					return;
				}

				setHasAnswered(true);
				onAnswer({
					selected: selectedOptions,
				});
				return;
			}

			// 上下键导航
			if (key.upArrow || input === 'k') {
				setSubmitWarning(null);
				if (cursorMode === 'cancel') {
					setCursorMode('custom');
				} else if (cursorMode === 'custom') {
					if (multiSelect) {
						setCursorMode('submit');
					} else if (optionItems.length > 0) {
						setCursorMode('options');
						setHighlightedOptionIndex(optionItems.length - 1);
					} else {
						setCursorMode('cancel');
					}
				} else if (cursorMode === 'submit') {
					if (optionItems.length > 0) {
						setCursorMode('options');
						setHighlightedOptionIndex(optionItems.length - 1);
					} else {
						setCursorMode('cancel');
					}
				} else if (optionItems.length > 0) {
					setHighlightedOptionIndex(prev =>
						prev > 0 ? prev - 1 : optionItems.length - 1,
					);
				}
				return;
			}

			if (key.downArrow || input === 'j') {
				setSubmitWarning(null);
				if (cursorMode === 'options') {
					if (optionItems.length === 0) {
						setCursorMode(multiSelect ? 'submit' : 'custom');
					} else if (highlightedOptionIndex < optionItems.length - 1) {
						setHighlightedOptionIndex(prev => prev + 1);
					} else {
						setCursorMode(multiSelect ? 'submit' : 'custom');
					}
				} else if (cursorMode === 'submit') {
					setCursorMode('custom');
				} else if (cursorMode === 'custom') {
					setCursorMode('cancel');
				} else {
					if (optionItems.length > 0) {
						setCursorMode('options');
						setHighlightedOptionIndex(0);
					} else {
						setCursorMode(multiSelect ? 'submit' : 'custom');
					}
				}
				return;
			}

			// Tab 键在动作按钮间跳转
			if (key.tab) {
				setSubmitWarning(null);
				if (multiSelect) {
					setCursorMode(prev => {
						if (prev === 'options') return 'submit';
						if (prev === 'submit') return 'custom';
						if (prev === 'custom') return 'cancel';
						return 'options';
					});
				} else {
					setCursorMode(prev => {
						if (prev === 'custom') return 'cancel';
						if (prev === 'cancel') return 'options';
						return 'custom';
					});
				}
				return;
			}

			// 空格键切换选中（多选模式）
			if (input === ' ' && cursorMode === 'options' && multiSelect) {
				const currentItem = optionItems[highlightedOptionIndex];
				if (currentItem) {
					toggleCheck(currentItem.index);
				}
				return;
			}

			// 数字键快速选择/切换
			const num = parseInt(input, 10);
			if (!isNaN(num) && num >= 1 && num <= allOptions.length) {
				const idx = num - 1;
				setCursorMode('options');
				setHighlightedOptionIndex(idx);
				if (multiSelect) {
					toggleCheck(idx);
				} else {
					// 单选模式下按数字键立即选择对应项并提交
					const targetOption = allOptions[idx];
					if (targetOption) {
						setHasAnswered(true);
						onAnswer({
							selected: targetOption,
						});
					}
				}
				return;
			}

			// 回车确认
			if (key.return) {
				handleSubmit();
				return;
			}

			// ESC键取消
			if (key.escape) {
				setHasAnswered(true);
				onAnswer({
					selected: '',
					cancelled: true,
				});
				return;
			}

			// e键编辑当前项
			if (input === 'e' || input === 'E') {
				setShowCustomInput(true);
				setSubmitWarning(null);

				if (cursorMode === 'custom' || cursorMode === 'cancel' || cursorMode === 'submit') {
					setCustomInput('');
				} else {
					const currentItem = optionItems[highlightedOptionIndex];
					if (!currentItem) return;
					setCustomInput(currentItem.label);
				}
			}
		},
		{isActive: !showCustomInput && !hasAnswered},
	);

	// 处理键盘输入 - 自定义输入模式
	useInput(
		(_input, key) => {
			if (!showCustomInput || hasAnswered) {
				return;
			}

			// ESC键返回选择列表
			if (key.escape) {
				handleCustomInputCancel();
				return;
			}
		},
		{isActive: showCustomInput && !hasAnswered},
	);

	const submitLabel = t.askUser.submitOption || '确认提交';
	const checkedCount = checkedIndices.size;

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
				<Text dimColor>
					{' '}
					(
					{multiSelect
						? t.askUser.multiSelectHint || '多选模式'
						: t.askUser.singleSelectHint || '单选模式'}
					)
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>{question}</Text>
			</Box>

			{!showCustomInput ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>
							{t.askUser.selectPrompt}
							{optionListScrollable
								? ` (${highlightedOptionIndex + 1}/${optionItems.length})`
								: ''}
						</Text>
					</Box>
					<Box flexDirection="column">
						{optionDisplayWindow.hiddenAbove > 0 ? (
							<Text color="gray" dimColor>
								↑{' '}
								{t.askUser.optionListMoreAbove.replace(
									'{count}',
									String(optionDisplayWindow.hiddenAbove),
								)}
							</Text>
						) : null}
						<Box flexDirection="column">
							{optionDisplayWindow.windowItems.map((item, rowIndex) => {
								const index =
									optionDisplayWindow.startIndex + rowIndex;
								const isHighlighted =
									cursorMode === 'options' &&
									index === highlightedOptionIndex;
								const isChecked =
									item.index >= 0 &&
									checkedIndices.has(item.index);

								return (
									<Box key={item.value}>
										<Text
											color={
												isHighlighted
													? theme.colors.menuInfo
													: undefined
											}
										>
											{isHighlighted ? '▸ ' : '  '}
										</Text>
										{multiSelect && (
											<Text
												color={
													isChecked
														? theme.colors.success
														: undefined
												}
												dimColor={!isChecked}
											>
												{isChecked ? '[✓] ' : '[ ] '}
											</Text>
										)}
										<Text
											color={
												isHighlighted
													? theme.colors.menuInfo
													: undefined
											}
											dimColor={!isHighlighted}
										>
											{item.index >= 0
												? `${item.index + 1}. `
												: ''}
											{formatOptionLabel(item.label, isHighlighted)}
										</Text>
									</Box>
								);
							})}
						</Box>
						{optionDisplayWindow.hiddenBelow > 0 ? (
							<Text color="gray" dimColor>
								↓{' '}
								{t.askUser.optionListMoreBelow.replace(
									'{count}',
									String(optionDisplayWindow.hiddenBelow),
								)}
							</Text>
						) : null}
					</Box>

					{submitWarning && (
						<Box marginTop={1}>
							<Text color={theme.colors.warning}>
								⚠ {submitWarning}
							</Text>
						</Box>
					)}

					<Box marginTop={1} flexDirection="column">
						{multiSelect && (
							<Box>
								<Text
									color={
										cursorMode === 'submit'
											? theme.colors.menuInfo
											: undefined
									}
								>
									{cursorMode === 'submit' ? '▸ ' : '  '}
								</Text>
								<Text
									color={
										cursorMode === 'submit'
											? theme.colors.menuInfo
											: undefined
									}
									dimColor={cursorMode !== 'submit'}
								>
									[✓ {submitLabel} ({checkedCount} 项已选)]
								</Text>
							</Box>
						)}
						<Box>
							<Text
								color={
									cursorMode === 'custom' ? theme.colors.menuInfo : undefined
								}
							>
								{cursorMode === 'custom' ? '▸ ' : '  '}
							</Text>
							<Text
								color={
									cursorMode === 'custom' ? theme.colors.menuInfo : undefined
								}
								dimColor={cursorMode !== 'custom'}
							>
								{t.askUser.customInputOption}
							</Text>
						</Box>
						<Box>
							<Text
								color={
									cursorMode === 'cancel' ? theme.colors.menuInfo : undefined
								}
							>
								{cursorMode === 'cancel' ? '▸ ' : '  '}
							</Text>
							<Text
								color={
									cursorMode === 'cancel' ? theme.colors.menuInfo : undefined
								}
								dimColor={cursorMode !== 'cancel'}
							>
								{t.askUser.cancelOption || 'Cancel'}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>
							{multiSelect
								? t.askUser.multiSelectKeyboardHints
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
