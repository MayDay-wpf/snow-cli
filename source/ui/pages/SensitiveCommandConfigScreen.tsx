import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert} from '@inkjs/ui';
import {
	getAllSensitiveCommands,
	toggleSensitiveCommand,
	addSensitiveCommand,
	removeSensitiveCommand,
	resetToDefaults,
	type SensitiveCommand,
} from '../../utils/sensitiveCommandManager.js';

// Focus event handling
const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) return false;
	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}
	const trimmed = value.trim();
	if (!trimmed) return false;
	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) return false;
	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) return '';
	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type ViewMode = 'list' | 'add';

export default function SensitiveCommandConfigScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const [commands, setCommands] = useState<SensitiveCommand[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [viewMode, setViewMode] = useState<ViewMode>('list');
	const [showSuccess, setShowSuccess] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');

	// Confirmation states
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);

	// Add custom command fields
	const [customPattern, setCustomPattern] = useState('');
	const [customDescription, setCustomDescription] = useState('');
	const [addField, setAddField] = useState<'pattern' | 'description'>(
		'pattern',
	);

	// Load commands
	const loadCommands = useCallback(() => {
		const allCommands = getAllSensitiveCommands();
		setCommands(allCommands);
	}, []);

	useEffect(() => {
		loadCommands();
	}, [loadCommands]);

	// Handle list view input
	const handleListInput = useCallback(
		(input: string, key: any) => {
			if (key.escape) {
				// Cancel any pending confirmations
				if (confirmDelete || confirmReset) {
					setConfirmDelete(false);
					setConfirmReset(false);
					return;
				}
				onBack();
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev => Math.max(0, prev - 1));
				// Clear confirmations when navigating
				setConfirmDelete(false);
				setConfirmReset(false);
			} else if (key.downArrow) {
				setSelectedIndex(prev => Math.min(commands.length - 1, prev + 1));
				// Clear confirmations when navigating
				setConfirmDelete(false);
				setConfirmReset(false);
			} else if (input === ' ') {
				// Toggle command
				const cmd = commands[selectedIndex];
				if (cmd) {
					toggleSensitiveCommand(cmd.id);
					loadCommands();
					setSuccessMessage(
						cmd.enabled
							? `Disabled: ${cmd.pattern}`
							: `Enabled: ${cmd.pattern}`,
					);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
				}
			} else if (input === 'a' || input === 'A') {
				// Add custom command
				setViewMode('add');
				setCustomPattern('');
				setCustomDescription('');
				setAddField('pattern');
			} else if (input === 'd' || input === 'D') {
				// Delete custom command - requires confirmation
				const cmd = commands[selectedIndex];
				if (cmd && !cmd.isPreset) {
					if (!confirmDelete) {
						// First press - ask for confirmation
						setConfirmDelete(true);
						setConfirmReset(false);
					} else {
						// Second press - execute delete
						removeSensitiveCommand(cmd.id);
						loadCommands();
						setSelectedIndex(prev => Math.min(prev, commands.length - 2));
						setSuccessMessage(`Deleted: ${cmd.pattern}`);
						setShowSuccess(true);
						setTimeout(() => setShowSuccess(false), 2000);
						setConfirmDelete(false);
					}
				}
			} else if (input === 'r' || input === 'R') {
				// Reset to defaults - requires confirmation
				if (!confirmReset) {
					// First press - ask for confirmation
					setConfirmReset(true);
					setConfirmDelete(false);
				} else {
					// Second press - execute reset
					resetToDefaults();
					loadCommands();
					setSelectedIndex(0);
					setSuccessMessage('Reset to default commands');
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
					setConfirmReset(false);
				}
			}
		},
		[
			commands,
			selectedIndex,
			onBack,
			loadCommands,
			confirmDelete,
			confirmReset,
		],
	);

	// Handle add view input
	const handleAddInput = useCallback((_input: string, key: any) => {
		if (key.escape) {
			setViewMode('list');
			return;
		}

		if (key.tab) {
			setAddField(prev => (prev === 'pattern' ? 'description' : 'pattern'));
		}
	}, []);

	// Use input hook
	useInput(
		(input, key) => {
			if (viewMode === 'list') {
				handleListInput(input, key);
			} else {
				handleAddInput(input, key);
			}
		},
		{isActive: true},
	);

	// Handle pattern input change
	const handlePatternChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomPattern(stripFocusArtifacts(value));
		}
	}, []);

	// Handle description input change
	const handleDescriptionChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomDescription(stripFocusArtifacts(value));
		}
	}, []);

	// Handle add submit
	const handleAddSubmit = useCallback(() => {
		if (addField === 'pattern') {
			setAddField('description');
		} else {
			// Submit
			if (customPattern.trim() && customDescription.trim()) {
				try {
					addSensitiveCommand(customPattern.trim(), customDescription.trim());
					loadCommands();
					setViewMode('list');
					setSuccessMessage(`Added: ${customPattern}`);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
				} catch (error: any) {
					// Handle error
				}
			}
		}
	}, [addField, customPattern, customDescription, loadCommands]);

	if (viewMode === 'add') {
		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color="cyan">
					Add Custom Sensitive Command
				</Text>
				<Box marginTop={1} />

				<Text dimColor>Pattern (supports wildcards, e.g., "rm*"):</Text>
				<Box>
					<Text color={addField === 'pattern' ? 'cyan' : 'gray'}>❯ </Text>
					<TextInput
						value={customPattern}
						onChange={handlePatternChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'pattern'}
					/>
				</Box>

				<Box marginTop={1} />
				<Text dimColor>Description:</Text>
				<Box>
					<Text color={addField === 'description' ? 'cyan' : 'gray'}>❯ </Text>
					<TextInput
						value={customDescription}
						onChange={handleDescriptionChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'description'}
					/>
				</Box>

				<Box marginTop={1} />
				<Text dimColor>Tab: Switch • Enter: Submit • Esc: Cancel</Text>
			</Box>
		);
	}

	// Calculate visible range for scrolling
	const viewportHeight = 13;
	const startIndex = Math.max(
		0,
		selectedIndex - Math.floor(viewportHeight / 2),
	);
	const endIndex = Math.min(commands.length, startIndex + viewportHeight);
	const adjustedStart = Math.max(0, endIndex - viewportHeight);

	const selectedCmd = commands[selectedIndex];

	return (
		<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
			<Text bold color="cyan">
				Sensitive Command Protection
			</Text>
			<Text dimColor>
				Configure commands that require confirmation even in
				YOLO/Always-Approved mode
			</Text>

			{showSuccess && (
				<Box marginTop={1}>
					<Alert variant="success">{successMessage}</Alert>
				</Box>
			)}

			<Box marginTop={1} />

			{commands.length === 0 ? (
				<Text dimColor>No commands configured</Text>
			) : (
				commands.map((cmd, index) => {
					// Only render items in the visible viewport
					if (index < adjustedStart || index >= endIndex) {
						return null;
					}

					return (
						<Text
							key={cmd.id}
							color={
								selectedIndex === index
									? 'cyan'
									: cmd.enabled
									? 'white'
									: 'gray'
							}
							bold={selectedIndex === index}
							dimColor={!cmd.enabled}
						>
							{selectedIndex === index ? '❯ ' : '  '}[{cmd.enabled ? '✓' : ' '}]{' '}
							{cmd.pattern}
							{!cmd.isPreset && <Text color="yellow"> (custom)</Text>}
						</Text>
					);
				})
			)}

			<Box marginTop={1} />
			{selectedCmd && !confirmDelete && !confirmReset && (
				<Text dimColor>
					{selectedCmd.description} (
					{selectedCmd.enabled ? 'Enabled' : 'Disabled'})
					{!selectedCmd.isPreset && ' [Custom]'}
				</Text>
			)}

			{confirmDelete && selectedCmd && (
				<Text bold color="yellow">
					⚠️ Press D again to confirm deletion of "{selectedCmd.pattern}"
				</Text>
			)}

			{confirmReset && (
				<Text bold color="yellow">
					⚠️ Press R again to confirm reset to default commands
				</Text>
			)}

			<Box marginTop={1} />
			<Text dimColor>
				{confirmDelete || confirmReset
					? 'Press the same key again to confirm • Esc: Cancel'
					: '↑↓: Navigate • Space: Toggle • A: Add • D: Delete • R: Reset • Esc: Back'}
			</Text>
		</Box>
	);
}
