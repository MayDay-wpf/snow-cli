import {useState, useCallback} from 'react';
import {TextBuffer} from '../utils/textBuffer.js';

// Command Definition
const commands = [
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
];

export function useCommandPanel(buffer: TextBuffer, isProcessing = false) {
	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);

	// Get filtered commands based on current input
	const getFilteredCommands = useCallback(() => {
		const text = buffer.getFullText();
		if (!text.startsWith('/')) return [];

		const query = text.slice(1).toLowerCase();
		return commands.filter(
			command =>
				command.name.toLowerCase().includes(query) ||
				command.description.toLowerCase().includes(query),
		);
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
