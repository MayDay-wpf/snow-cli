import {
	useState,
	useCallback,
	useMemo,
	useEffect,
	useSyncExternalStore,
} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {useI18n} from '../../i18n/index.js';
import {getCustomCommands} from '../../utils/commands/custom.js';
import {commandUsageManager} from '../../utils/session/commandUsageManager.js';
import {runningSubAgentTracker} from '../../utils/execution/runningSubAgentTracker.js';
import {teamTracker} from '../../utils/execution/teamTracker.js';
import {getAllProfiles} from '../../utils/config/configManager.js';
import {getCurrentLanguage} from '../../utils/config/languageConfig.js';
import {
	findInlineCommandTrigger,
	isInlineCommand,
} from '../input/keyboard/utils/inlineCommandTrigger.js';
import {
	filterAndRankCommands,
	findExactMatchIndex,
	resolveCommandMeta,
	cycleCategoryFilter,
	type CommandCategory,
	type CommandCategoryFilter,
} from '../../utils/commands/commandMatch.js';

const subscribeToSubAgentTracker = (cb: () => void) =>
	runningSubAgentTracker.subscribe(cb);
const getSubAgentSnapshot = () => runningSubAgentTracker.getRunningAgents();
const subscribeToTeamTracker = (cb: () => void) => teamTracker.subscribe(cb);
const getTeamSnapshot = () => teamTracker.getRunningTeammates();

export type CommandPanelCommand = {
	name: string;
	description: string;
	type: 'builtin' | 'execute' | 'prompt' | 'panel';
	category?: CommandCategory;
	rankBoost?: number;
	mainFlowOnly?: boolean;
	isCustom?: boolean;
	insertionText?: string;
};

export type CommandArgOption =
	| string
	| {
			label: string;
			value: string;
	  };

export function getCommandArgOptionLabel(option: CommandArgOption): string {
	return typeof option === 'string' ? option : option.label;
}

export function getCommandArgOptionValue(option: CommandArgOption): string {
	return typeof option === 'string' ? option : option.value;
}

// 指令参数提示：当用户输入 /cmd 后（尚未补充参数），在输入框末尾以暗色显示可用参数组合
// key 为指令名（不含斜杠），value 为提示文本（不含前导空格）
export const COMMAND_ARGS_HINTS: Record<string, string> = {
	branch: '[name]',
	resume: '[sessionId]',
	reindex: '[-force]',
	codebase: '[on|off|status]',
	'auto-format': '[on|off|status]',
	buddy: '[status|hatch|pet|rename|set|say|profile|mute|unmute|reset]',
	simple: '[on|off|status]',
	'agents-inject': '[on|off|status]',
	'add-dir': '[path]',
	loop: '[daemon] <interval> <prompt> | daily HH:mm <prompt> | at HH:mm <prompt> | list | tasks | cancel <id>',
	goal: '<objective> [--budget=N] | pause | resume | clear | status',
	init: '[prompt]',
	role: '[-l|--list | -d|--delete]',
	skills: '[-l|--list | install <github-url>]',
	'role-subagent': '[-l|--list | -d|--delete]',
	'subagent-depth': '[<number>|status]',
	btw: '<question>',
	deepresearch: '<prompt>',
	connect: '[apiUrl]',
	export: '[txt|md|html|json]',
	config: '<export|import>',
	'tool-display': '[完整full|精简compact|隐藏hidden|status]',
	'tool-icons':
		'[on|off|status|status on|off|status:<key>:<glyph>|<tool>:<emoji>]',
	'tool-names': '[status|clear|<tool>:<name> …]',
	'tool-name': '[status|clear|<tool>:<name> …]',
	'think-display': '[完整full|精简compact|status]',
	// 参数提示：默认 slots；status 只查询，不切换
	'subagent-display': '[槽位slots|多行multi|精简compact|隐藏hidden|status]',
	display: '[status|tool|think|subagent] [mode]',
	speedometer: '[on|off|status]',
};


// 指令参数可选值列表：用于 Tab 弹出参数选择面板
// key 为指令名（不含斜杠），value 为可选参数值数组
export const COMMAND_ARGS_OPTIONS: Record<string, CommandArgOption[]> = {
	codebase: ['on', 'off', 'status'],
	'auto-format': ['on', 'off', 'status'],
	buddy: [
		'status',
		'hatch',
		'pet',
		'rename',
		'set',
		'customize',
		'say',
		'profile',
		'mute',
		'unmute',
		'reset',
	],
	simple: ['on', 'off', 'status'],
	'agents-inject': ['on', 'off', 'status'],
	reindex: ['-force'],
	role: ['-l', '-d'],
	skills: ['-l', 'install'],
	'role-subagent': ['-l', '-d'],
	'subagent-depth': ['status'],
	loop: ['daemon', 'daily', 'at', 'list', 'tasks', 'cancel'],
	export: ['txt', 'md', 'html', 'json'],
	config: ['export', 'import'],
	'tool-display': ['full', 'compact', 'hidden', 'status'],
	'tool-icons': ['on', 'off', 'status', 'status on', 'status off'],
	'tool-names': ['status', 'clear'],
	'tool-name': ['status', 'clear'],
	'think-display': ['full', 'compact', 'status'],
	'subagent-display': ['slots', 'multi', 'compact', 'hidden', 'status'],
	display: ['status', 'tool', 'think', 'subagent', 'help'],
	speedometer: ['on', 'off', 'status'],
};

function getBuddyProfileArgOptions(): CommandArgOption[] {
	return [
		'list',
		'current',
		'default',
		'reset',
		...getAllProfiles().map(profile => ({
			label: `${profile.name}${profile.isActive ? ' (active)' : ''}`,
			value: profile.name,
		})),
	];
}

function isZhLanguage(): boolean {
	const lang = getCurrentLanguage();
	return lang === 'zh' || lang === 'zh-TW';
}

/** Labeled choices so the args picker explains each mode (not bare tokens). */
function getToolDisplayArgOptions(): CommandArgOption[] {
	if (isZhLanguage()) {
		return [
			{value: 'full', label: '完整 (full) · 显示工具名 + 参数 + 结果'},
			{value: 'compact', label: '精简 (compact) · 仅工具名 + 简要状态'},
			{value: 'hidden', label: '隐藏 (hidden) · 不显示工具调用'},
			{value: 'status', label: 'status · 查看当前模式（不切换）'},
		];
	}
	return [
		{value: 'full', label: 'full · show tool name + args + result'},
		{value: 'compact', label: 'compact · tool name + brief status only'},
		{value: 'hidden', label: 'hidden · hide tool calls'},
		{value: 'status', label: 'status · show current mode (no change)'},
	];
}

function getThinkDisplayArgOptions(): CommandArgOption[] {
	if (isZhLanguage()) {
		return [
			{value: 'full', label: '完整 (full) · 全量思考内容'},
			{value: 'compact', label: '精简 (compact) · 压缩后的思考摘要'},
			{value: 'status', label: 'status · 查看当前模式（不切换）'},
		];
	}
	return [
		{value: 'full', label: 'full · full thinking content'},
		{value: 'compact', label: 'compact · condensed thinking summary'},
		{value: 'status', label: 'status · show current mode (no change)'},
	];
}

function getSubAgentDisplayArgOptions(): CommandArgOption[] {
	if (isZhLanguage()) {
		return [
			{
				value: 'slots',
				label: '槽位 (slots) · 默认：agent 容器 + 当前焦点覆盖',
			},
			{
				value: 'multi',
				label: '多行 (multi) · agent 容器 + 最近多行历史',
			},
			{
				value: 'compact',
				label: '精简 (compact) · 仅 agent 标题/耗时',
			},
			{
				value: 'hidden',
				label: '隐藏 (hidden) · 关闭实时面板（旧工具卡片）',
			},
			{
				value: 'status',
				label: 'status · 查看当前模式（不切换）',
			},
		];
	}
	return [
		{
			value: 'slots',
			label: 'slots · default: agent container + focus overwrite',
		},
		{
			value: 'multi',
			label: 'multi · agent container + recent multi-line history',
		},
		{
			value: 'compact',
			label: 'compact · agent header / elapsed only',
		},
		{
			value: 'hidden',
			label: 'hidden · disable live panel (legacy tool cards)',
		},
		{
			value: 'status',
			label: 'status · show current mode (no change)',
		},
	];
}

function getDisplayArgOptions(): CommandArgOption[] {
	if (isZhLanguage()) {
		return [
			{value: 'status', label: 'status · 查看当前显示设置'},
			{value: 'tool', label: 'tool · 切换工具显示模式'},
			{value: 'think', label: 'think · 切换思考显示模式'},
			{value: 'subagent', label: 'subagent · 切换子代理显示模式'},
			{value: 'help', label: 'help · 查看用法'},
		];
	}
	return [
		{value: 'status', label: 'status · show current display settings'},
		{value: 'tool', label: 'tool · cycle tool display mode'},
		{value: 'think', label: 'think · cycle think display mode'},
		{value: 'subagent', label: 'subagent · cycle sub-agent display mode'},
		{value: 'help', label: 'help · show usage'},
	];
}

export function getCommandArgsOptions(
	commandName: string,
	inputText?: string,
): CommandArgOption[] {
	if (
		commandName === 'buddy' &&
		/^\/buddy\s+profile\s*$/.test(inputText ?? '')
	) {
		return getBuddyProfileArgOptions();
	}

	if (commandName === 'tool-display') {
		return getToolDisplayArgOptions();
	}
	if (commandName === 'think-display') {
		return getThinkDisplayArgOptions();
	}
	if (commandName === 'subagent-display') {
		return getSubAgentDisplayArgOptions();
	}
	if (commandName === 'display') {
		return getDisplayArgOptions();
	}

	// Check static dictionary first
	const staticOptions = COMMAND_ARGS_OPTIONS[commandName];
	if (staticOptions) {
		return staticOptions;
	}

	// Fall back to custom commands cache for namespaced commands (e.g., oms:auto)
	const customCmd = getCustomCommands().find(cmd => cmd.name === commandName);
	if (customCmd?.argsOptions && customCmd.argsOptions.length > 0) {
		return customCmd.argsOptions;
	}

	return [];
}

// 查询命令参数提示文本：先查静态字典，再查自定义命令缓存
export function getCommandArgsHint(commandName: string): string {
	// Check static dictionary first
	const staticHint = COMMAND_ARGS_HINTS[commandName];
	if (staticHint) {
		return staticHint;
	}

	// Fall back to custom commands cache for namespaced commands (e.g., oms:auto)
	const customCmd = getCustomCommands().find(cmd => cmd.name === commandName);
	return customCmd?.argsHint ?? '';
}

export function useCommandPanel(
	buffer: TextBuffer,
	isProcessing = false,
	isPaused = false,
) {
	const {t} = useI18n();

	const subAgents = useSyncExternalStore(
		subscribeToSubAgentTracker,
		getSubAgentSnapshot,
	);
	const teammates = useSyncExternalStore(
		subscribeToTeamTracker,
		getTeamSnapshot,
	);
	const hasRunningAgentsOrTeam = subAgents.length > 0 || teammates.length > 0;

	// Built-in commands - only depends on translation
	const builtInCommands = useMemo(
		() => [
			{
				name: 'branch',
				description:
					t.commandPanel.commands.branch ||
					'Fork current conversation into a new branch',
			},
			{name: 'help', description: t.commandPanel.commands.help},
			{name: 'clear', description: t.commandPanel.commands.clear},
			{name: 'del-session', description: t.commandPanel.commands.delSession},
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
				name: 'goal',
				description:
					t.commandPanel.commands.goal ||
					'Set a persistent goal that drives auto-continuation (Ralph Loop)',
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
				name: 'context',
				description:
					t.commandPanel.commands.context ||
					'Break down context: system / ROLE / AGENTS / hooks / tools / messages',
			},
			{
				name: 'agents-inject',
				description:
					t.commandPanel.commands.agentsInject ||
					'Toggle AGENTS.md inject into model-bound messages. Usage: /agents-inject [on|off|status]',
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
				name: 'models',
				description:
					t.commandPanel.commands.models || 'Open the model switching panel',
			},
			{
				name: 'loop',
				description:
					t.commandPanel.commands.loop ||
					'Schedule recurring tasks. Usage: /loop 5m <prompt> or /loop daily 09:30 <prompt>',
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
				name: 'config',
				description:
					t.commandPanel.commands.config ||
					'Export Snow CLI configuration to YAML',
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
				name: 'simple',
				description:
					t.commandPanel.commands.simple ||
					'Toggle theme simple mode. Usage: /simple [on|off|status]',
			},
			{
				name: 'buddy',
				description:
					t.commandPanel.commands.buddy ||
					'Manage your terminal companion. Usage: /buddy [hatch|pet|rename|set|say|mute|unmute|status|reset]',
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
				name: 'image-compress',
				description:
					t.commandPanel.commands.imageCompress ||
					'Toggle Image Compress mode (history -> PNG image)',
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
				name: 'telemetry',
				description:
					t.commandPanel.commands.telemetry ||
					'Configure OpenTelemetry telemetry exporters and endpoint',
			},
			{
				name: 'team',
				description:
					t.commandPanel.commands.team ||
					'Toggle Agent Team mode - orchestrate multiple agents working together',
			},
			{
				name: 'ultra-todo',
				description:
					t.commandPanel.commands.ultraTodo ||
					'Toggle Ultra TODO mode with phase-gated task management',
			},
			{
				name: 'pixel',
				description:
					t.commandPanel.commands.pixel || 'Open the terminal pixel editor',
				mainFlowOnly: true,
			},
			{
				name: 'games',
				description:
					t.commandPanel.commands.games ||
					'Open the games panel - play built-in and plugin games',
				mainFlowOnly: true,
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
			{
				name: 'deepresearch',
				description:
					t.commandPanel.commands.deepresearch ||
					'Run an autonomous multi-step web research workflow and save a cited markdown report to .snow/deepresearch/',
			},
			{
				name: 'tool-display',
				description:
					t.commandPanel.commands.toolDisplay ||
					'Control tool call display mode. Usage: /tool-display [full|compact|hidden|status]',
			},
			{
				name: 'tool-icons',
				description:
					t.commandPanel.commands.toolIcons ||
					'Control tool category icons. Usage: /tool-icons [on|off|status|<tool>:<emoji>]',
			},
			{
				name: 'tool-names',
				description:
					t.commandPanel.commands.toolNames ||
					'Override tool display names. Usage: /tool-names [status|<tool>:<display>]',
			},
			{
				name: 'think-display',
				description:
					t.commandPanel.commands.thinkDisplay ||
					'Control thinking content display mode. Usage: /think-display [full|compact|status]',
			},
			{
				name: 'subagent-display',
				description:
					t.commandPanel.commands.subAgentDisplay ||
					'Control sub-agent live panel. Usage: /subagent-display [slots|multi|compact|hidden|status]',
			},
			{
				name: 'display',
				description:
					t.commandPanel.commands.display ||
					'Display settings panel. Usage: /display | /display status | /display tool|think|subagent [mode]',
			},
			{
				name: 'speedometer',
				description:
					t.commandPanel.commands.speedometer ||
					'Toggle real-time speedometer to monitor token/s output rate',
			},
			{
				name: 'cut',
				description:
					t.commandPanel.commands.cut || 'Interrupt AI and send a message',
				allowDuringProcessing: true,
			},
			{
				name: 'pause',
				description:
					t.commandPanel.commands.pause ||
					'Pause the AI loop at the next round',
				allowDuringProcessing: true,
			},
			{
				name: 'continue',
				description:
					t.commandPanel.commands.continue || 'Resume the AI loop after /pause',
				allowDuringProcessing: true,
			},
		],
		[t],
	);

	const normalizedBuiltInCommands = useMemo<CommandPanelCommand[]>(
		() =>
			builtInCommands.map(command => {
				const meta = resolveCommandMeta(command.name);
				return {
					name: command.name,
					description: command.description,
					type: (command as any).allowDuringProcessing ? 'prompt' : 'builtin',
					category: meta.category,
					rankBoost: meta.rankBoost,
					mainFlowOnly: (command as any).mainFlowOnly || false,
				};
			}),
		[builtInCommands],
	);

	// Get all commands (built-in + custom) - dynamically fetch custom commands
	const getAllCommands = useCallback((): CommandPanelCommand[] => {
		const customCommands = getCustomCommands().map(cmd => {
			const meta = resolveCommandMeta(cmd.name, true);
			return {
				name: cmd.name,
				description: cmd.description || cmd.command,
				type: cmd.type,
				category: meta.category,
				rankBoost: meta.rankBoost,
				isCustom: true,
				insertionText: cmd.type === 'prompt' ? cmd.command : undefined,
			};
		});
		return [...normalizedBuiltInCommands, ...customCommands];
	}, [normalizedBuiltInCommands]);

	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
	const [usageLoaded, setUsageLoaded] = useState(false);
	const [commandCategoryFilter, setCommandCategoryFilter] =
		useState<CommandCategoryFilter>('frequent');

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

	const buildRankOptions = useCallback(
		() => ({
			recentNames: commandUsageManager.getRecentSync(5),
			getLastUsed: (name: string) => commandUsageManager.getLastUsedSync(name),
			categoryFilter: commandCategoryFilter,
		}),
		[commandCategoryFilter, usageLoaded],
	);

	// Get filtered commands based on current input
	// - Empty query: recent ∪ frequent (or category tab)
	// - With query: full-set search (exact > prefix > boundary > substring > abbr > desc)
	const getFilteredCommands = useCallback((): CommandPanelCommand[] => {
		const text = buffer.text;
		const cursorPosition = buffer.getCursorPosition();
		const trigger = findInlineCommandTrigger(text, cursorPosition);
		if (!trigger) return [];

		const query = trigger.query.toLowerCase();

		// Get all commands (including latest custom commands)
		const allCommands = getAllCommands();
		const availableCommands = isProcessing
			? allCommands.filter(
					command =>
						command.type === 'prompt' &&
						!(command.mainFlowOnly && hasRunningAgentsOrTeam) &&
						// Hide 'pause' when already paused; hide 'continue' when not paused
						!(command.name === 'pause' && isPaused) &&
						!(command.name === 'continue' && !isPaused),
			  )
			: trigger.isAtStart
			? allCommands.filter(
					// /pause and /continue only make sense during AI processing
					command => command.name !== 'pause' && command.name !== 'continue',
			  )
			: allCommands.filter(isInlineCommand);

		return filterAndRankCommands(
			availableCommands,
			query,
			name => commandUsageManager.getUsageCountSync(name),
			buildRankOptions(),
		);
	}, [
		buffer,
		getAllCommands,
		isProcessing,
		isPaused,
		hasRunningAgentsOrTeam,
		usageLoaded,
		buildRankOptions,
	]);

	// Update command panel state
	const updateCommandPanelState = useCallback(
		(_text: string, cursorPosition?: number) => {
			const trigger = findInlineCommandTrigger(
				buffer.text,
				cursorPosition ?? buffer.getCursorPosition(),
			);
			if (!trigger) {
				setShowCommands(false);
				setCommandSelectedIndex(0);
				// Match default open tab (frequent), not full "all" list.
				setCommandCategoryFilter('frequent');
				return;
			}

			const allCommands = getAllCommands();
			const availableCommands = trigger.isAtStart
				? allCommands
				: allCommands.filter(isInlineCommand);
			const query = trigger.query.toLowerCase();
			// Typing a query resets category tab to all (search is global)
			if (query) {
				setCommandCategoryFilter(prev => (prev === 'all' ? prev : 'all'));
			}
			const ranked = filterAndRankCommands(
				availableCommands,
				query,
				name => commandUsageManager.getUsageCountSync(name),
				{
					...buildRankOptions(),
					// When query is non-empty, categoryFilter is ignored by ranker
					categoryFilter: query ? 'all' : commandCategoryFilter,
				},
			);
			const hasMatch = ranked.length > 0;

			setShowCommands(hasMatch);
			// Prefer exact name match as the default selection when typing a query.
			const exactIndex = findExactMatchIndex(ranked, query);
			setCommandSelectedIndex(exactIndex >= 0 ? exactIndex : 0);
		},
		[buffer, getAllCommands, buildRankOptions, commandCategoryFilter],
	);

	const cycleCommandCategory = useCallback((direction: 1 | -1) => {
		setCommandCategoryFilter(prev => cycleCategoryFilter(prev, direction));
		setCommandSelectedIndex(0);
	}, []);

	return {
		showCommands,
		setShowCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		getFilteredCommands,
		updateCommandPanelState,
		getAllCommands,
		commandCategoryFilter,
		setCommandCategoryFilter,
		cycleCommandCategory,
	};
}
