import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import WrappedTextInput, {
	getWrappedInputHeight,
} from '../components/common/WrappedTextInput.js';
import {
	DEFAULT_RETRY_CATEGORIES,
	getDefaultCategoryKeywords,
	getRetryPolicyConfig,
	saveRetryPolicyConfig,
	splitRetryKeywords,
	type RetryPolicyConfig,
} from '../../utils/config/retryPolicyConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {toCodePoints, visualWidth} from '../../utils/core/textUtils.js';

type Props = {
	onBack: () => void;
};

type Row =
	| {kind: 'always'}
	| {kind: 'category'; id: string}
	| {kind: 'custom'};

const KEYWORD_INDENT = 6;
/**
 * 预留的安全列宽。部分终端对全角标点等字符的实际占宽与 string-width 的计算不一致，
 * 若行宽紧贴终端列数，终端会提前自动换行，导致 Ink 记录的行数偏小，
 * 切换选中项重绘时擦除不干净而出现重复绘制。因此所有行都按更窄的宽度预先处理。
 */
const WIDTH_SAFETY_MARGIN = 4;
/**
 * 为父级页面（例如主菜单顶部的分隔线/标题）预留的行数。页面总高度超过终端行数时，
 * Ink 无法原地擦除旧帧，同样会出现重复绘制，因此类别列表按剩余高度开窗显示。
 */
const OUTER_RESERVED_LINES = 6;
/** 「已保存」提示的自动消失时长 */
const STATUS_AUTO_DISMISS_MS = 2000;
/** 关键词编辑框最多显示的文本行数，超出时随光标滚动 */
const EDITOR_MAX_LINES = 8;

/** 按显示宽度截断为单行，超出部分以省略号结尾 */
function truncateToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return '';
	if (visualWidth(text) <= maxWidth) return text;
	let result = '';
	let width = 0;
	for (const char of toCodePoints(text)) {
		const charWidth = visualWidth(char);
		if (width + charWidth > maxWidth - 3) break;
		result += char;
		width += charWidth;
	}
	return `${result}...`;
}

/** 按显示宽度手动折行，保证 Ink 不再自行换行，行数可预期 */
function wrapToWidth(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [text];
	const lines: string[] = [];
	let current = '';
	let width = 0;
	for (const char of toCodePoints(text)) {
		const charWidth = visualWidth(char);
		if (width + charWidth > maxWidth && current) {
			lines.push(current.trimEnd());
			current = char === ' ' ? '' : char;
			width = char === ' ' ? 0 : charWidth;
			continue;
		}
		current += char;
		width += charWidth;
	}
	if (current) lines.push(current.trimEnd());
	return lines.length > 0 ? lines : [''];
}

/**
 * 重试策略配置页面（对齐 Snow App 的「重试策略」面板）。
 *
 * 决定哪些错误会触发重试：可开启「任何错误都重试」，或逐个启用/禁用内置错误类别、
 * 自定义各类别的关键词，并追加额外关键词。作用于所有 API 档案，修改即时保存到
 * ~/.snow/retry-policy.json（见 utils/config/retryPolicyConfig.ts）。
 * 最大重试次数与重试间隔仍在各 API 档案中单独配置。
 */
export default function RetryPolicyConfigScreen({onBack}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	useTerminalTitle(`Snow CLI - ${t.retryPolicy.title}`);
	const {columns, rows: terminalRows} = useTerminalSize();

	const [policy, setPolicy] = useState<RetryPolicyConfig>(() =>
		getRetryPolicyConfig(),
	);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isEditing, setIsEditing] = useState(false);
	const [editValue, setEditValue] = useState('');
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	// 保存提示仅短暂显示；每次保存都会刷新 statusVersion 以重新计时
	const [statusVersion, setStatusVersion] = useState(0);

	useEffect(() => {
		if (!status) return;
		const timer = setTimeout(() => setStatus(''), STATUS_AUTO_DISMISS_MS);
		return () => clearTimeout(timer);
	}, [status, statusVersion]);

	const rows: Row[] = useMemo(() => {
		if (policy.always) {
			return [{kind: 'always'}];
		}
		return [
			{kind: 'always'},
			...DEFAULT_RETRY_CATEGORIES.map(
				category => ({kind: 'category', id: category.id} as Row),
			),
			{kind: 'custom'},
		];
	}, [policy.always]);

	const safeIndex = Math.min(selectedIndex, rows.length - 1);
	const currentRow = rows[safeIndex]!;

	const categoryLabel = (id: string): string =>
		(t.retryPolicy.categoryLabels as Record<string, string>)[id] ?? id;

	const persist = (next: RetryPolicyConfig) => {
		setPolicy(next);
		try {
			saveRetryPolicyConfig(next);
			setError('');
			setStatus(t.retryPolicy.saved);
			setStatusVersion(prev => prev + 1);
		} catch (err) {
			setStatus('');
			setError(err instanceof Error ? err.message : t.retryPolicy.saveError);
		}
	};

	const toggleRow = (row: Row) => {
		if (row.kind === 'always') {
			persist({...policy, always: !policy.always});
			return;
		}
		if (row.kind === 'category') {
			const state = policy.categories[row.id] ?? {enabled: true, keywords: ''};
			persist({
				...policy,
				categories: {
					...policy.categories,
					[row.id]: {...state, enabled: !state.enabled},
				},
			});
		}
	};

	const startEditing = (row: Row) => {
		if (row.kind === 'category') {
			// 未自定义时以默认关键词预填，用户可在其基础上增删，而不是只能整体覆盖
			const saved = policy.categories[row.id]?.keywords ?? '';
			setEditValue(saved || getDefaultCategoryKeywords(row.id).join(', '));
			setIsEditing(true);
		} else if (row.kind === 'custom') {
			setEditValue(policy.customKeywords);
			setIsEditing(true);
		}
	};

	const commitEditing = () => {
		const value = editValue.trim();
		if (currentRow.kind === 'category') {
			const state = policy.categories[currentRow.id] ?? {
				enabled: true,
				keywords: '',
			};
			// 与默认关键词完全一致时保存为空，继续跟随内置默认值
			const isDefault =
				splitRetryKeywords(value).join(',') ===
				getDefaultCategoryKeywords(currentRow.id).join(',');
			persist({
				...policy,
				categories: {
					...policy.categories,
					[currentRow.id]: {...state, keywords: isDefault ? '' : value},
				},
			});
		} else if (currentRow.kind === 'custom') {
			persist({...policy, customKeywords: value});
		}
		setIsEditing(false);
	};

	const resetCategoryKeywords = (row: Row) => {
		if (row.kind !== 'category') return;
		const state = policy.categories[row.id] ?? {enabled: true, keywords: ''};
		if (!state.keywords) return;
		persist({
			...policy,
			categories: {
				...policy.categories,
				[row.id]: {...state, keywords: ''},
			},
		});
	};

	// 浏览模式输入处理
	useInput(
		(input, key) => {
			if (key.escape) {
				onBack();
				return;
			}
			if (key.upArrow) {
				setSelectedIndex(safeIndex > 0 ? safeIndex - 1 : rows.length - 1);
				return;
			}
			if (key.downArrow) {
				setSelectedIndex(safeIndex < rows.length - 1 ? safeIndex + 1 : 0);
				return;
			}
			if (input === ' ') {
				toggleRow(currentRow);
				return;
			}
			if (input === 'r' || input === 'R') {
				resetCategoryKeywords(currentRow);
				return;
			}
			if (key.return) {
				if (currentRow.kind === 'always') {
					toggleRow(currentRow);
				} else {
					startEditing(currentRow);
				}
			}
		},
		{isActive: !isEditing},
	);

	// 编辑模式的按键（含 Enter 提交、Esc 取消）由 WrappedTextInput 自行处理

	// ---- 布局计算：所有行预先按安全宽度折行/截断，并按终端高度对类别列表开窗 ----
	// 页面 padding={1} 左右各占 1 列，再预留安全列宽
	const contentWidth = Math.max(20, columns - 2 - WIDTH_SAFETY_MARGIN);
	const indentedWidth = Math.max(10, contentWidth - KEYWORD_INDENT);
	// 编辑框替换原本 1 行的关键词预览，额外占用的行数需计入布局
	const editorExtraLines = isEditing
		? getWrappedInputHeight(editValue, indentedWidth, EDITOR_MAX_LINES) - 1
		: 0;

	const subtitleLines = wrapToWidth(t.retryPolicy.subtitle, contentWidth);
	const alwaysHintLines = wrapToWidth(t.retryPolicy.alwaysHint, indentedWidth);
	const customHintLines = wrapToWidth(
		t.retryPolicy.customKeywordsHint,
		indentedWidth,
	);
	const footerHintLines = wrapToWidth(
		isEditing ? t.retryPolicy.editingHint : t.retryPolicy.navigationHint,
		contentWidth,
	);

	const categoryRowIndexes = rows
		.map((row, index) => (row.kind === 'category' ? index : -1))
		.filter(index => index >= 0);
	const categoryCount = categoryRowIndexes.length;

	// 除类别列表外的行数：padding(2) + 页头 + 错误提示 + 「任何错误」行 + 分组标题
	// + 滚动提示 + 额外关键词行 + 底部（状态行固定占位，保证高度稳定）
	const chromeLines =
		2 +
		1 +
		subtitleLines.length +
		1 +
		(error ? 4 : 0) +
		1 +
		alwaysHintLines.length +
		1 +
		(categoryCount > 0 ? 2 + 1 + 1 + 1 + 1 + customHintLines.length : 0) +
		1 +
		1 +
		footerHintLines.length +
		editorExtraLines;
	const availableCategoryLines = Math.max(
		0,
		terminalRows - chromeLines - OUTER_RESERVED_LINES,
	);
	const visibleCategoryCount = Math.min(
		categoryCount,
		Math.max(isEditing ? 1 : 3, Math.floor(availableCategoryLines / 2)),
	);

	const selectedCategoryPos = categoryRowIndexes.indexOf(safeIndex);
	let windowStart = 0;
	if (categoryCount > visibleCategoryCount) {
		const anchor = selectedCategoryPos >= 0 ? selectedCategoryPos : 0;
		windowStart = Math.min(
			Math.max(0, anchor - Math.floor(visibleCategoryCount / 2)),
			categoryCount - visibleCategoryCount,
		);
	}
	const visibleCategoryIndexes = categoryRowIndexes.slice(
		windowStart,
		windowStart + visibleCategoryCount,
	);
	const hiddenAbove = windowStart;
	const hiddenBelow = categoryCount - windowStart - visibleCategoryIndexes.length;

	const renderIndicator = (index: number) =>
		index === safeIndex ? '❯ ' : '  ';

	const rowColor = (index: number) =>
		index === safeIndex ? theme.colors.menuSelected : theme.colors.menuNormal;

	const renderAlwaysRow = (index: number) => {
		const isActive = index === safeIndex;
		return (
			<Box key="always" flexDirection="column" marginBottom={1}>
				<Text color={rowColor(index)} bold={isActive}>
					{truncateToWidth(
						`${renderIndicator(index)}${policy.always ? '[x] ' : '[ ] '}${
							t.retryPolicy.alwaysLabel
						}`,
						contentWidth,
					)}
				</Text>
				<Box marginLeft={KEYWORD_INDENT} flexDirection="column">
					{alwaysHintLines.map((line, lineIndex) => (
						<Text key={lineIndex} color={theme.colors.menuSecondary} dimColor>
							{line}
						</Text>
					))}
				</Box>
			</Box>
		);
	};

	const renderCategoryRow = (index: number) => {
		const row = rows[index];
		if (!row || row.kind !== 'category') return null;
		const isActive = index === safeIndex;
		const isRowEditing = isActive && isEditing;
		const state = policy.categories[row.id] ?? {enabled: true, keywords: ''};
		const defaults =
			DEFAULT_RETRY_CATEGORIES.find(item => item.id === row.id)?.keywords ?? [];
		const preview = state.keywords
			? state.keywords
			: `${t.retryPolicy.defaultKeywordsPrefix}${defaults.join(', ')}`;

		return (
			<Box key={row.id} flexDirection="column">
				<Text
					color={state.enabled ? rowColor(index) : theme.colors.menuSecondary}
					bold={isActive}
				>
					{truncateToWidth(
						`${renderIndicator(index)}${
							state.enabled ? '[x] ' : '[ ] '
						}${categoryLabel(row.id)}`,
						contentWidth,
					)}
				</Text>
				<Box marginLeft={KEYWORD_INDENT} width={indentedWidth}>
					{isRowEditing ? (
						<WrappedTextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={commitEditing}
							onCancel={() => setIsEditing(false)}
							width={indentedWidth}
							maxVisibleLines={EDITOR_MAX_LINES}
							placeholder={t.retryPolicy.emptyMeansDefault}
							borderColor={theme.colors.menuSelected}
							placeholderColor={theme.colors.menuSecondary}
						/>
					) : (
						<Text color={theme.colors.menuSecondary} dimColor>
							{truncateToWidth(preview, indentedWidth)}
						</Text>
					)}
				</Box>
			</Box>
		);
	};

	const renderCustomRow = (index: number) => {
		const isActive = index === safeIndex;
		const isRowEditing = isActive && isEditing;
		return (
			<Box key="custom" flexDirection="column" marginTop={1}>
				<Text color={rowColor(index)} bold={isActive}>
					{truncateToWidth(
						`${renderIndicator(index)}${t.retryPolicy.customKeywordsLabel}`,
						contentWidth,
					)}
				</Text>
				<Box
					marginLeft={KEYWORD_INDENT}
					width={indentedWidth}
					flexDirection="column"
				>
					{isRowEditing ? (
						<WrappedTextInput
							value={editValue}
							onChange={setEditValue}
							onSubmit={commitEditing}
							onCancel={() => setIsEditing(false)}
							width={indentedWidth}
							maxVisibleLines={EDITOR_MAX_LINES}
							placeholder="quota exceeded, billing"
							borderColor={theme.colors.menuSelected}
							placeholderColor={theme.colors.menuSecondary}
						/>
					) : (
						<Text color={theme.colors.menuSecondary}>
							{policy.customKeywords
								? truncateToWidth(policy.customKeywords, indentedWidth)
								: t.retryPolicy.notSet}
						</Text>
					)}
					{customHintLines.map((line, lineIndex) => (
						<Text key={lineIndex} color={theme.colors.menuSecondary} dimColor>
							{line}
						</Text>
					))}
				</Box>
			</Box>
		);
	};

	const customRowIndex = rows.findIndex(row => row.kind === 'custom');
	const scrollHint =
		hiddenAbove > 0 || hiddenBelow > 0
			? [
					hiddenAbove > 0 ? `↑ ${hiddenAbove}` : '',
					hiddenBelow > 0 ? `↓ ${hiddenBelow}` : '',
			  ]
					.filter(Boolean)
					.join('  ')
			: ' ';

	return (
		<Box flexDirection="column" padding={1} width={contentWidth + 2}>
			<Box marginBottom={1} flexDirection="column">
				<Text bold color={theme.colors.menuInfo}>
					{truncateToWidth(t.retryPolicy.title, contentWidth)}
				</Text>
				{subtitleLines.map((line, lineIndex) => (
					<Text key={lineIndex} color={theme.colors.menuSecondary} dimColor>
						{line}
					</Text>
				))}
			</Box>

			{error && (
				<Box marginBottom={1}>
					<Alert variant="error">
						{truncateToWidth(error, Math.max(10, contentWidth - 6))}
					</Alert>
				</Box>
			)}

			{renderAlwaysRow(0)}

			{categoryCount > 0 && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text bold color={theme.colors.menuInfo}>
							{truncateToWidth(t.retryPolicy.categoriesTitle, contentWidth)}
						</Text>
					</Box>
					{visibleCategoryIndexes.map(index => renderCategoryRow(index))}
					<Text color={theme.colors.menuSecondary} dimColor>
						{scrollHint}
					</Text>
					{customRowIndex >= 0 && renderCustomRow(customRowIndex)}
				</Box>
			)}

			<Box marginTop={1} flexDirection="column">
				<Text color={theme.colors.success}>
					{status && !error ? truncateToWidth(status, contentWidth) : ' '}
				</Text>
				{footerHintLines.map((line, lineIndex) => (
					<Text key={lineIndex} color={theme.colors.menuSecondary} dimColor>
						{line}
					</Text>
				))}
			</Box>
		</Box>
	);
}
