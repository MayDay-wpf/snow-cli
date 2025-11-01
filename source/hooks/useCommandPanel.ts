import {useState, useCallback} from 'react';
import {TextBuffer} from '../utils/textBuffer.js';

// Command Definition
const commands = [
	{name: 'help', description: 'Show keyboard shortcuts and help information'},
	{name: 'clear', description: 'Clear chat context and conversation history'},
	{name: 'resume', description: 'Resume a conversation'},
	{name: 'mcp', description: 'Show Model Context Protocol services and tools'},
	{
		name: 'yolo',
		description: 'Toggle unattended mode (auto-approve all tools)',
	},
	{
		name: 'init',
		description: 'Analyze project and generate/update SNOW.md documentation',
	},
	{name: 'ide', description: 'Connect to VSCode editor and sync context'},
	{
		name: 'compact',
		description: 'Compress conversation history using compact model',
	},
	{name: 'home', description: 'Return to welcome screen to modify settings'},
	{
		name: 'review',
		description:
			'Review git changes and identify potential issues. Support: /review [optional note]',
	},
	{
		name: 'role',
		description: 'Open or create ROLE.md file to customize AI assistant role',
	},
	{
		name: 'usage',
		description: 'View token usage statistics with interactive charts',
	},
	{
		name: 'export',
		description: 'Export chat conversation to text file with save dialog',
	},
	{
		name: 'agent-',
		description: 'Select and use a sub-agent to handle specific tasks',
	},
	{
		name: 'todo-',
		description: 'Search and select TODO comments from project files',
	},
];

export function useCommandPanel(buffer: TextBuffer, isProcessing = false) {
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
	}, [buffer]);

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
