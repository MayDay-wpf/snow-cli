import { useState, useCallback } from 'react';
import { TextBuffer } from '../utils/textBuffer.js';

// Command Definition
const commands = [
	{ name: 'clear', description: 'Clear chat context and conversation history' },
	{ name: 'resume', description: 'Resume a conversation' },
	{ name: 'mcp', description: 'Show Model Context Protocol services and tools' },
	{
		name: 'yolo',
		description: 'Toggle unattended mode (auto-approve all tools)',
	},
	{
		name: 'init',
		description: 'Analyze project and generate/update SNOW.md documentation',
	},
	{ name: 'ide', description: 'Connect to VSCode editor and sync context' },
	{
		name: 'compact',
		description: 'Compress conversation history using compact model',
	},
];

export function useCommandPanel(buffer: TextBuffer) {
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
	};
}
