import {useState, useCallback, useMemo, useEffect} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {useI18n} from '../../i18n/index.js';
import {getCustomCommands} from '../../utils/commands/custom.js';
import {commandUsageManager} from '../../utils/session/commandUsageManager.js';

export function useCommandPanel(buffer: TextBuffer, isProcessing = false) {
	const {t} = useI18n();

	// Built-in commands - only depends on translation
	const builtInCommands = useMemo(
		() => [
			{name: 'help', description: t.commandPanel.commands.help},
			{name: 'clear', description: t.commandPanel.commands.clear},
			{name: 'resume', description: t.commandPanel.commands.resume},
			{name: 'mcp', description: t.commandPanel.commands.mcp},
			{
				name: 'yolo',
				description: t.commandPanel.commands.yolo,
			},
			{
				name: 'plan',
				description: t.commandPanel.commands.plan,
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
				name: 'custom',
				description: t.commandPanel.commands.custom || 'Add custom command',
			},
			{
				name: 'skills',
				description: t.commandPanel.commands.skills || 'Create skill template',
			},
			{
				name: 'agent-',
				description: t.commandPanel.commands.agent,
			},
			{
				name: 'todo-',
				description: t.commandPanel.commands.todo,
			},
			{
				name: 'add-dir',
				description: t.commandPanel.commands.addDir || 'Add working directory',
			},
			{
				name: 'reindex',
				description: t.commandPanel.commands.reindex,
			},
			{
				name: 'quit',
				description: t.commandPanel.commands.quit,
			},
		],
		[t],
	);

	// Get all commands (built-in + custom) - dynamically fetch custom commands
	const getAllCommands = useCallback(() => {
		const customCommands = getCustomCommands().map(cmd => ({
			name: cmd.name,
			description: cmd.description || cmd.command,
		}));
		return [...builtInCommands, ...customCommands];
	}, [builtInCommands]);

	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
	const [usageLoaded, setUsageLoaded] = useState(false);

	// Load command usage data on mount
	// Use isMounted flag to prevent state update on unmounted component
	useEffect(() => {
		let isMounted = true;

		commandUsageManager.ensureLoaded().then(() => {
			if (isMounted) {
				setUsageLoaded(true);
			}
		});

		return () => {
			isMounted = false;
		};
	}, []);

	// Get filtered commands based on current input
	// Sorting strategy:
	// - Empty query: Sort by usage frequency (most used first)
	// - With query: Sort by match priority, then by usage frequency within same priority
	const getFilteredCommands = useCallback(() => {
		const text = buffer.getFullText();
		if (!text.startsWith('/')) return [];

		const query = text.slice(1).toLowerCase();

		// Get all commands (including latest custom commands)
		const allCommands = getAllCommands();

		// Filter and sort commands by priority and usage frequency
		// Priority order:
		// 1. Command starts with query (highest)
		// 2. Command contains query
		// 3. Description starts with query
		// 4. Description contains query (lowest)
		const filtered = allCommands
			.filter(
				command =>
					command.name.toLowerCase().includes(query) ||
					command.description.toLowerCase().includes(query),
			)
			.map(command => {
				const nameLower = command.name.toLowerCase();
				const descLower = command.description.toLowerCase();
				const usageCount = commandUsageManager.getUsageCountSync(command.name);

				let priority = 4; // Default: description contains query

				if (nameLower.startsWith(query)) {
					priority = 1; // Command starts with query
				} else if (nameLower.includes(query)) {
					priority = 2; // Command contains query
				} else if (descLower.startsWith(query)) {
					priority = 3; // Description starts with query
				}

				return {command, priority, usageCount};
			})
			.sort((a, b) => {
				// When query is empty, sort primarily by usage frequency
				if (query === '') {
					// Sort by usage count (descending), then alphabetically
					if (a.usageCount !== b.usageCount) {
						return b.usageCount - a.usageCount;
					}
					return a.command.name.localeCompare(b.command.name);
				}

				// With query: sort by priority first, then by usage frequency
				if (a.priority !== b.priority) {
					return a.priority - b.priority;
				}
				// Same priority: sort by usage count (descending)
				if (a.usageCount !== b.usageCount) {
					return b.usageCount - a.usageCount;
				}
				// Same usage count: sort alphabetically
				return a.command.name.localeCompare(b.command.name);
			})
			.map(item => item.command);

		return filtered;
	}, [buffer, getAllCommands, usageLoaded]);

	// Update command panel state
	const updateCommandPanelState = useCallback((text: string) => {
		// Check if / is at the start (not preceded by @ or #)
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
		getAllCommands, // Export function to get all commands dynamically
		isProcessing, // Export isProcessing for CommandPanel to use
	};
}
