import {useState, useCallback, useMemo, useEffect, useSyncExternalStore} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {useI18n} from '../../i18n/index.js';
import {getCustomCommands} from '../../utils/commands/custom.js';
import {commandUsageManager} from '../../utils/session/commandUsageManager.js';
import {runningSubAgentTracker} from '../../utils/execution/runningSubAgentTracker.js';
import {teamTracker} from '../../utils/execution/teamTracker.js';

const subscribeToSubAgentTracker = (cb: () => void) => runningSubAgentTracker.subscribe(cb);
const getSubAgentSnapshot = () => runningSubAgentTracker.getRunningAgents();
const subscribeToTeamTracker = (cb: () => void) => teamTracker.subscribe(cb);
const getTeamSnapshot = () => teamTracker.getRunningTeammates();

export type CommandPanelCommand = {
	name: string;
	description: string;
	type: 'builtin' | 'execute' | 'prompt';
	mainFlowOnly?: boolean;
};

export function useCommandPanel(buffer: TextBuffer, isProcessing = false) {
	const {t} = useI18n();

	const subAgents = useSyncExternalStore(subscribeToSubAgentTracker, getSubAgentSnapshot);
	const teammates = useSyncExternalStore(subscribeToTeamTracker, getTeamSnapshot);
	const hasRunningAgentsOrTeam = subAgents.length > 0 || teammates.length > 0;

	// Built-in commands - only depends on translation
	const builtInCommands = useMemo(
		() => [
			{name: 'help', description: t.commandPanel.commands.help},
			{name: 'clear', description: t.commandPanel.commands.clear},
			{
				name: 'copy-last',
				description:
					t.commandPanel.commands.copyLast ||
					'Copy last AI message to clipboard',
			},
			{name: 'resume', description: t.commandPanel.commands.resume},
			{name: 'mcp', description: t.commandPanel.commands.mcp},
			{name: 'yolo', description: t.commandPanel.commands.yolo},
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
				name: 'gitline',
				description:
					t.commandPanel.commands.gitline ||
					'Select git commits and insert them into the chat input',
			},
		{
			name: 'role',
			description: t.commandPanel.commands.role,
		},
		{
			name: 'role-subagent',
			description:
				t.commandPanel.commands.roleSubagent ||
				'Customize sub-agent prompts with ROLE-{name}.md files. Use -l to list, -d to delete',
		},
			{
				name: 'usage',
				description: t.commandPanel.commands.usage,
			},
			{
				name: 'backend',
				description:
					t.commandPanel.commands.backend || 'Show background processes',
			},
			{
				name: 'profiles',
				description: t.commandPanel.commands.profiles,
			},
			{
				name: 'loop',
				description:
					t.commandPanel.commands.loop ||
					'Schedule a session-scoped recurring task. Usage: /loop 5m <prompt>',
			},
			{
				name: 'models',
				description: t.commandPanel.commands.models,
			},
			{
				name: 'subagent-depth',
				description:
					t.commandPanel.commands.subAgentDepth ||
					'Set the maximum nested spawn depth for sub-agents',
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
				name: 'todolist',
				description:
					t.commandPanel.commands.todolist ||
					'Show current session TODO tree and manage items',
			},
			{
				name: 'skills-',
				description:
					t.commandPanel.commands.skillsPicker ||
					'Select a skill and inject its content into the input',
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
				name: 'codebase',
				description:
					t.commandPanel.commands.codebase ||
					'Toggle codebase indexing for current project',
			},
			{
				name: 'permissions',
				description:
					t.commandPanel.commands.permissions || 'Manage tool permissions',
			},
			{
				name: 'vulnerability-hunting',
				description:
					t.commandPanel.commands.vulnerabilityHunting ||
					'Toggle vulnerability hunting mode',
			},
			{
				name: 'auto-format',
				description:
					t.commandPanel.commands.autoFormat ||
					'Toggle MCP file auto-formatting. Usage: /auto-format [on|off|status]',
			},
			{
				name: 'tool-search',
				description:
					t.commandPanel.commands.toolSearch ||
					'Toggle Tool Search (progressive tool loading)',
			},
			{
				name: 'worktree',
				description:
					t.commandPanel.commands.worktree ||
					'Open Git branch management panel',
			},
			{
				name: 'hybrid-compress',
				description:
					t.commandPanel.commands.hybridCompress ||
					'Toggle Hybrid Compress mode (AI summary + smart truncation)',
			},
			{
				name: 'diff',
				description:
					t.commandPanel.commands.diff ||
					'Review file changes from a conversation in IDE diff view',
			},
			{
				name: 'connect',
				description:
					t.commandPanel.commands.connect ||
					'Connect to a Snow Instance for AI processing',
			},
			{
				name: 'disconnect',
				description:
					t.commandPanel.commands.disconnect ||
					'Disconnect from the current Snow Instance',
			},
			{
				name: 'connection-status',
				description:
					t.commandPanel.commands.connectionStatus ||
					'Show current connection status',
			},
			{
				name: 'new-prompt',
				description:
					t.commandPanel.commands.newPrompt ||
					'Generate a refined prompt from your requirement using AI',
			},
			{
				name: 'team',
				description:
					t.commandPanel.commands.team ||
					'Toggle Agent Team mode - orchestrate multiple agents working together',
			},
		{
			name: 'quit',
			description: t.commandPanel.commands.quit,
		},
		{
			name: 'btw',
			description:
				t.commandPanel.commands.btw ||
				'Ask a side-question while AI is working (temporary, no context saved)',
			allowDuringProcessing: true,
			mainFlowOnly: true,
		},
	],
	[t],
);

	const normalizedBuiltInCommands = useMemo<CommandPanelCommand[]>(
		() =>
			builtInCommands.map(command => ({
				name: command.name,
				description: command.description,
				type: (command as any).allowDuringProcessing ? 'prompt' : 'builtin',
				mainFlowOnly: (command as any).mainFlowOnly || false,
			})),
		[builtInCommands],
	);

	// Get all commands (built-in + custom) - dynamically fetch custom commands
	const getAllCommands = useCallback((): CommandPanelCommand[] => {
		const customCommands = getCustomCommands().map(cmd => ({
			name: cmd.name,
			description: cmd.description || cmd.command,
			type: cmd.type,
		}));
		return [...normalizedBuiltInCommands, ...customCommands];
	}, [normalizedBuiltInCommands]);

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
	const getFilteredCommands = useCallback((): CommandPanelCommand[] => {
		const text = buffer.getFullText();
		if (!text.startsWith('/')) return [];

		const query = text.slice(1).toLowerCase();

		// Get all commands (including latest custom commands)
		const allCommands = getAllCommands();
		const availableCommands = isProcessing
			? allCommands.filter(command =>
				command.type === 'prompt' && !(command.mainFlowOnly && hasRunningAgentsOrTeam),
			)
			: allCommands;

		// Filter and sort commands by priority and usage frequency
		// Priority order:
		// 1. Command starts with query (highest)
		// 2. Command contains query
		// 3. Description starts with query
		// 4. Description contains query (lowest)
		const filtered = availableCommands
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
	}, [buffer, getAllCommands, isProcessing, hasRunningAgentsOrTeam, usageLoaded]);

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
		getAllCommands,
	};
}
