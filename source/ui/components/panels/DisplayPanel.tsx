import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import Menu from '../common/Menu.js';
import {
	getToolDisplayMode,
	setToolDisplayMode,
	getThinkDisplayMode,
	setThinkDisplayMode,
	getSubAgentDisplayMode,
	setSubAgentDisplayMode,
	type ToolDisplayMode,
	type ThinkDisplayMode,
	type SubAgentDisplayMode,
} from '../../../utils/config/themeConfig.js';
import {configEvents} from '../../../utils/config/configEvents.js';

type Props = {
	visible: boolean;
	onClose: () => void;
};

const TOOL_CYCLE: ToolDisplayMode[] = ['full', 'compact', 'hidden'];
const THINK_CYCLE: ThinkDisplayMode[] = ['compact', 'full'];
const SUBAGENT_CYCLE: SubAgentDisplayMode[] = [
	'slots',
	'multi',
	'compact',
	'hidden',
];

function nextOf<T extends string>(cycle: readonly T[], current: T): T {
	const idx = cycle.indexOf(current);
	return cycle[(idx + 1) % cycle.length] ?? cycle[0]!;
}

export default function DisplayPanel({visible, onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [toolMode, setToolMode] = useState<ToolDisplayMode>(() =>
		getToolDisplayMode(),
	);
	const [thinkMode, setThinkMode] = useState<ThinkDisplayMode>(() =>
		getThinkDisplayMode(),
	);
	const [subAgentMode, setSubAgentMode] = useState<SubAgentDisplayMode>(() =>
		getSubAgentDisplayMode(),
	);
	const [infoText, setInfoText] = useState('');

	useEffect(() => {
		if (!visible) return;
		setToolMode(getToolDisplayMode());
		setThinkMode(getThinkDisplayMode());
		setSubAgentMode(getSubAgentDisplayMode());
		setInfoText('');
	}, [visible]);

	const labels = useMemo(() => {
		const panel = t.displayPanel;
		return {
			title: panel.title,
			tool: panel.tool,
			think: panel.think,
			subagent: panel.subagent,
			toolInfo: panel.toolInfo,
			thinkInfo: panel.thinkInfo,
			subagentInfo: panel.subagentInfo,
			close: panel.close,
			closeInfo: panel.closeInfo,
			hint: panel.hint,
		};
	}, [t]);

	const formatMode = t.displayPanel.formatMode;

	const options = useMemo(
		() => [
			{
				label: `${labels.tool} ${formatMode(toolMode)}`,
				value: 'tool',
				infoText: labels.toolInfo,
			},
			{
				label: `${labels.think} ${formatMode(thinkMode)}`,
				value: 'think',
				infoText: labels.thinkInfo,
			},
			{
				label: `${labels.subagent} ${formatMode(subAgentMode)}`,
				value: 'subagent',
				infoText: labels.subagentInfo,
			},
			{
				label: labels.close,
				value: 'close',
				color: 'gray',
				infoText: labels.closeInfo,
			},
		],
		[labels, formatMode, toolMode, thinkMode, subAgentMode],
	);

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'close') {
				onClose();
				return;
			}
			if (value === 'tool') {
				const next = nextOf(TOOL_CYCLE, toolMode);
				setToolMode(next);
				setToolDisplayMode(next);
				configEvents.emitConfigChange({type: 'toolDisplayMode', value: next});
				return;
			}
			if (value === 'think') {
				const next = nextOf(THINK_CYCLE, thinkMode);
				setThinkMode(next);
				setThinkDisplayMode(next);
				configEvents.emitConfigChange({type: 'thinkDisplayMode', value: next});
				return;
			}
			if (value === 'subagent') {
				const next = nextOf(SUBAGENT_CYCLE, subAgentMode);
				setSubAgentMode(next);
				setSubAgentDisplayMode(next);
				configEvents.emitConfigChange({
					type: 'subAgentDisplayMode',
					value: next,
				});
			}
		},
		[onClose, toolMode, thinkMode, subAgentMode],
	);

	useInput(
		(_input, key) => {
			if (key.escape) onClose();
		},
		{isActive: visible},
	);

	if (!visible) return null;

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={1}
			paddingY={0}
		>
			<Text color={theme.colors.menuInfo} bold>
				{labels.title}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{t.displayPanel.statusLine(toolMode, thinkMode, subAgentMode)}
			</Text>
			<Menu
				options={options}
				onSelect={handleSelect}
				onSelectionChange={text => setInfoText(text)}
				maxHeight={6}
			/>
			{infoText ? (
				<Text color={theme.colors.menuSecondary} dimColor>
					{infoText}
				</Text>
			) : null}
			<Text color={theme.colors.menuSecondary} dimColor>
				{labels.hint}
			</Text>
		</Box>
	);
}
