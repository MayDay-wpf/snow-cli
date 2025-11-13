import {useState, useCallback} from 'react';
import {TextBuffer} from '../utils/textBuffer.js';
import {useI18n} from '../i18n/index.js';

export function useCommandPanel(buffer: TextBuffer, isProcessing = false) {
	const {t} = useI18n();

	// Command Definition
	const commands = [
		{name: 'help', description: t.commandPanel.commands.help},
		{name: 'clear', description: t.commandPanel.commands.clear},
		{name: 'resume', description: t.commandPanel.commands.resume},
		{name: 'mcp', description: t.commandPanel.commands.mcp},
		{
			name: 'yolo',
			description: t.commandPanel.commands.yolo,
		},
		{
			name: 'init',
			description: t.commandPanel.commands.init,
		},
		{name: 'ide', description: t.commandPanel.commands.ide},
		{
			name: 'compact',
			description: t.commandPanel.commands.compact,
		},
		{name: 'home', description: t.commandPanel.commands.home},
		{
			name: 'review',
			description: t.commandPanel.commands.review,
		},
		{
			name: 'role',
			description: t.commandPanel.commands.role,
		},
		{
			name: 'usage',
			description: t.commandPanel.commands.usage,
		},
		{
			name: 'export',
			description: t.commandPanel.commands.export,
		},
		{
			name: 'agent-',
			description: t.commandPanel.commands.agent,
		},
		{
			name: 'todo-',
			description: t.commandPanel.commands.todo,
		},
	];

	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

	// Get filtered commands based on current input
	const getFilteredCommands = useCallback(() => {
		const text = buffer.getFullText();
		if (!text.startsWith('/')) return [];

		const query = text.slice(1).toLowerCase();

		// Filter and sort commands by priority
		// Priority order:
		// 1. Command starts with query (highest)
		// 2. Command contains query
		// 3. Description starts with query
		// 4. Description contains query (lowest)
		const filtered = commands
			.filter(
				command =>
					command.name.toLowerCase().includes(query) ||
					command.description.toLowerCase().includes(query),
			)
			.map(command => {
				const nameLower = command.name.toLowerCase();
				const descLower = command.description.toLowerCase();

				let priority = 4; // Default: description contains query

				if (nameLower.startsWith(query)) {
					priority = 1; // Command starts with query
				} else if (nameLower.includes(query)) {
					priority = 2; // Command contains query
				} else if (descLower.startsWith(query)) {
					priority = 3; // Description starts with query
				}

				return {command, priority};
			})
			.sort((a, b) => {
				// Sort by priority (lower number = higher priority)
				if (a.priority !== b.priority) {
					return a.priority - b.priority;
				}
				// If same priority, sort alphabetically by name
				return a.command.name.localeCompare(b.command.name);
			})
			.map(item => item.command);

		return filtered;
	}, [buffer, commands]);

	// Update command panel state
	const updateCommandPanelState = useCallback((text: string) => {
		if (text.startsWith('/') && text.length > 0) {
			setShowCommands(true);
			setCommandSelectedIndex(0);
		} else {
			setShowCommands(false);
			setCommandSelectedIndex(0);
		}
	}, []);

	return {
		showCommands,
		setShowCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		getFilteredCommands,
		updateCommandPanelState,
		commands,
		isProcessing, // Export isProcessing for CommandPanel to use
	};
}
