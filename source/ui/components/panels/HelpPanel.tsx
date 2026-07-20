import React, {useState, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';

// Get platform-specific paste key
const getPasteKey = () => {
	return process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
};

type HelpLine =
	| {
			type: 'title';
			text: string;
			colorKey: 'info' | 'warning' | 'success' | 'cyan' | 'menu';
	  }
	| {type: 'item'; text: string; dim?: boolean}
	| {type: 'spacer'};

export default function HelpPanel() {
	const pasteKey = getPasteKey();
	const {t} = useI18n();
	const {theme} = useTheme();
	const {rows: terminalHeight} = useTerminalSize();

	const colorFor = (
		key: 'info' | 'warning' | 'success' | 'cyan' | 'menu',
	): string => {
		switch (key) {
			case 'warning':
				return theme.colors.warning;
			case 'success':
				return theme.colors.success;
			case 'cyan':
				return theme.colors.cyan;
			case 'menu':
				return theme.colors.menuInfo;
			case 'info':
			default:
				return theme.colors.menuInfo;
		}
	};

	const lines: HelpLine[] = useMemo(() => {
		const result: HelpLine[] = [];
		result.push({type: 'title', text: t.helpPanel.title, colorKey: 'info'});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.textEditingTitle,
			colorKey: 'warning',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteToStart}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteToEnd}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.copyInput}`});
		result.push({
			type: 'item',
			text: ` • ${t.helpPanel.pasteImages.replace('{pasteKey}', pasteKey)}`,
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.toggleExpandedView}`});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.readlineTitle,
			colorKey: 'cyan',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.moveToLineStart}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.moveToLineEnd}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.forwardWord}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.backwardWord}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteToLineEnd}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteToLineStart}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteWord}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.deleteChar}`});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.quickAccessTitle,
			colorKey: 'success',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.insertFiles}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.searchContent}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.selectAgent}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.showCommands}`});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.bashModeTitle,
			colorKey: 'warning',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.bashModeTrigger}`});
		result.push({
			type: 'item',
			text: `   ${t.helpPanel.bashModeDesc}`,
			dim: true,
		});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.navigationTitle,
			colorKey: 'menu',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.navigateHistory}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.selectItem}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.cancelClose}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.toggleYolo}`});
		result.push({type: 'spacer'});

		result.push({
			type: 'title',
			text: t.helpPanel.tipsTitle,
			colorKey: 'info',
		});
		result.push({type: 'item', text: ` • ${t.helpPanel.tipUseHelp}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.tipShowCommands}`});
		result.push({type: 'item', text: ` • ${t.helpPanel.tipInterrupt}`});

		return result;
	}, [t, pasteKey]);

	// Adaptive height: leave room for chrome + scroll hints
	const maxVisible = Math.max(
		8,
		Math.min(lines.length, Math.max(10, terminalHeight - 8)),
	);
	const canScroll = lines.length > maxVisible;

	const [offset, setOffset] = useState(0);

	useInput((_input, key) => {
		if (!canScroll) return;
		if (key.upArrow) {
			setOffset(prev => Math.max(0, prev - 1));
		} else if (key.downArrow) {
			setOffset(prev => Math.min(lines.length - maxVisible, prev + 1));
		} else if (key.pageUp) {
			setOffset(prev => Math.max(0, prev - maxVisible));
		} else if (key.pageDown) {
			setOffset(prev => Math.min(lines.length - maxVisible, prev + maxVisible));
		}
	});

	const clampedOffset = Math.min(
		Math.max(0, offset),
		Math.max(0, lines.length - maxVisible),
	);
	const visibleLines = lines.slice(clampedOffset, clampedOffset + maxVisible);
	const hiddenAbove = clampedOffset;
	const hiddenBelow = Math.max(0, lines.length - clampedOffset - maxVisible);

	const renderLine = (line: HelpLine, index: number) => {
		if (line.type === 'spacer') {
			return <Box key={`spacer-${index}`} height={1} />;
		}
		if (line.type === 'title') {
			return (
				<Text key={`line-${index}`} bold color={colorFor(line.colorKey)}>
					{line.text}
				</Text>
			);
		}
		return (
			<Text
				key={`line-${index}`}
				color={theme.colors.menuSecondary}
				dimColor={line.dim}
			>
				{line.text}
			</Text>
		);
	};

	return (
		<Box flexDirection="column" paddingX={1}>
			{canScroll && hiddenAbove > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↑ {t.commandPanel.moreAbove.replace('{count}', String(hiddenAbove))}
				</Text>
			)}
			{visibleLines.map((line, idx) => renderLine(line, clampedOffset + idx))}
			{canScroll && hiddenBelow > 0 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					↓ {t.commandPanel.moreBelow.replace('{count}', String(hiddenBelow))}
				</Text>
			)}
			{canScroll && (
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.commandPanel.scrollHint}
					</Text>
				</Box>
			)}
		</Box>
	);
}
