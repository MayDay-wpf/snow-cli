import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type Props = {
	alwaysApprovedTools: Set<string>;
	onRemoveTool: (toolName: string) => void;
	onClearAll: () => void;
	onClose: () => void;
};

type PermissionsMessages = {
	title?: string;
	clearAll?: string;
	noTools?: string;
	hint?: string;
	confirmDelete?: string;
	confirmClearAll?: string;
	yes?: string;
	no?: string;
};

// Confirmation target: tool index or 'clearAll'
type ConfirmTarget = number | 'clearAll' | null;

export default function PermissionsPanel({
	alwaysApprovedTools,
	onRemoveTool,
	onClearAll,
	onClose,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const messages: PermissionsMessages = (t as any).permissionsPanel ?? {};
	const tools = useMemo(
		() => Array.from(alwaysApprovedTools).sort((a, b) => a.localeCompare(b)),
		[alwaysApprovedTools],
	);
	const [selectedIndex, setSelectedIndex] = useState(0);
	// Confirmation state: null = not confirming, number = tool index, 'clearAll' = clear all
	const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
	// 0 = Yes selected, 1 = No selected
	const [confirmOption, setConfirmOption] = useState<0 | 1>(0);

	const hasTools = tools.length > 0;
	const clearAllIndex = hasTools ? tools.length : -1;
	const optionCount = hasTools ? tools.length + 1 : 0;

	// Keep selection in bounds as the list changes
	useEffect(() => {
		if (optionCount === 0) {
			setSelectedIndex(0);
			return;
		}
		if (selectedIndex >= optionCount) {
			setSelectedIndex(optionCount - 1);
		}
	}, [optionCount, selectedIndex]);

	// Reset confirmation when tools change
	useEffect(() => {
		setConfirmTarget(null);
		setConfirmOption(0);
	}, [alwaysApprovedTools]);

	const handleInput = useCallback(
		(_: string, key: any) => {
			// In confirmation mode
			if (confirmTarget !== null) {
				if (key.escape) {
					// Cancel confirmation
					setConfirmTarget(null);
					setConfirmOption(0);
					return;
				}

				if (key.upArrow || key.downArrow) {
					// Toggle Yes/No
					setConfirmOption(prev => (prev === 0 ? 1 : 0));
					return;
				}

				if (key.return) {
					if (confirmOption === 0) {
						// Yes - execute delete
						if (confirmTarget === 'clearAll') {
							onClearAll();
							setSelectedIndex(0);
						} else {
							const tool = tools[confirmTarget];
							if (tool) {
								onRemoveTool(tool);
								// Shift selection up when removing the last item
								if (confirmTarget >= tools.length - 1) {
									setSelectedIndex(Math.max(0, confirmTarget - 1));
								}
							}
						}
					}
					// No or Yes completed - reset confirmation
					setConfirmTarget(null);
					setConfirmOption(0);
					return;
				}
				return;
			}

			// Normal mode
			if (key.escape) {
				onClose();
				return;
			}

			if (optionCount === 0) {
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev => (prev === 0 ? optionCount - 1 : prev - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedIndex(prev => (prev === optionCount - 1 ? 0 : prev + 1));
				return;
			}

			if (key.return) {
				// Enter confirmation mode instead of direct delete
				if (selectedIndex === clearAllIndex) {
					setConfirmTarget('clearAll');
				} else {
					setConfirmTarget(selectedIndex);
				}
				setConfirmOption(0); // Default to Yes
			}
		},
		[
			optionCount,
			selectedIndex,
			clearAllIndex,
			onClose,
			onClearAll,
			onRemoveTool,
			tools,
			confirmTarget,
			confirmOption,
		],
	);

	useInput(handleInput);

	// Get the name of the tool being confirmed for deletion
	const getConfirmingToolName = (): string => {
		if (confirmTarget === 'clearAll') {
			return '';
		}
		if (typeof confirmTarget === 'number') {
			return tools[confirmTarget] ?? '';
		}
		return '';
	};

	// Render confirmation dialog
	if (confirmTarget !== null) {
		const isConfirmingClearAll = confirmTarget === 'clearAll';
		const toolName = getConfirmingToolName();

		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor="red"
				paddingX={2}
				paddingY={1}
			>
				<Text color="red" bold>
					{isConfirmingClearAll
						? messages.confirmClearAll ?? 'Clear all permissions?'
						: messages.confirmDelete ?? 'Delete allowed tool?'}
				</Text>

				{!isConfirmingClearAll && toolName && (
					<Box marginTop={1} flexDirection="column">
						<Text color="white" bold>
							{'  '}
							{toolName}
						</Text>
					</Box>
				)}

				<Box marginTop={1} flexDirection="column">
					<Text
						color={
							confirmOption === 0
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
						bold={confirmOption === 0}
					>
						{confirmOption === 0 ? '❯ ' : '  '}
						{messages.yes ?? 'Yes'}
					</Text>
					<Text
						color={
							confirmOption === 1
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
						bold={confirmOption === 1}
					>
						{confirmOption === 1 ? '❯ ' : '  '}
						{messages.no ?? 'No'}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={2}
			paddingY={1}
		>
			<Text color="cyan" bold>
				{messages.title ?? 'Permissions'}
			</Text>

			{hasTools ? (
				<Box flexDirection="column" marginTop={1}>
					{tools.map((tool, index) => {
						const isSelected = index === selectedIndex;
						return (
							<Text
								key={tool}
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isSelected}
							>
								{isSelected ? '❯ ' : '  '}
								{tool}
							</Text>
						);
					})}

					<Box marginTop={1}>
						<Text
							color={
								selectedIndex === clearAllIndex
									? theme.colors.warning
									: theme.colors.menuSecondary
							}
							bold={selectedIndex === clearAllIndex}
						>
							{selectedIndex === clearAllIndex ? '❯ ' : '  '}
							{messages.clearAll ?? 'Clear All'}
						</Text>
					</Box>
				</Box>
			) : (
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						{messages.noTools ?? 'No tools are always approved'}
					</Text>
				</Box>
			)}

			<Box marginTop={1}>
				<Text color="gray" dimColor>
					{messages.hint ?? '↑↓ navigate • Enter remove • ESC close'}
				</Text>
			</Box>
		</Box>
	);
}
