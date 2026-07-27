export interface CommandResult {
	success: boolean;
	message?: string;
	action?:
		| 'clear'
		| 'deleteCurrentSession'
		| 'resume'
		| 'info'
		| 'showMcpInfo'
		| 'toggleYolo'
		| 'togglePlan'
		| 'toggleSimple'
		| 'toggleToolDisplay'
		| 'toggleThinkDisplay'
		| 'toggleVulnerabilityHunting'
		| 'toggleToolSearch'
		| 'initProject'
		| 'compact'
		| 'showSessionPanel'
		| 'showMcpPanel'
		| 'showUsagePanel'
		| 'showContextPanel'
		| 'showBackgroundPanel'
		| 'showWorkingDirPanel'
		| 'home'
		| 'review'
		| 'showReviewCommitPanel'
		| 'exportChat'
		| 'exportConfig'
		| 'importConfig'
		| 'showAgentPicker'
		| 'showTodoPicker'
		| 'showTodoListPanel'
		| 'showProfilePanel'
		| 'showModelsPanel'
		| 'showSubAgentDepthPanel'
		| 'showDisplayPanel'
		| 'showSkillsPicker'
		| 'showGitLinePicker'
		| 'help'
		| 'pixel'
		| 'showCustomCommandConfig'
		| 'executeCustomCommand'
		| 'executeTerminalCommand'
		| 'deleteCustomCommand'
		| 'showAnyPanel'
		| 'showSkillsCreation'
		| 'showSkillsListPanel'
		| 'showSkillsInstall'
		| 'showRoleCreation'
		| 'showRoleDeletion'
		| 'showRoleList'
		| 'showRoleSubagentCreation'
		| 'showRoleSubagentDeletion'
		| 'showRoleSubagentList'
		| 'showPermissionsPanel'
		| 'reindexCodebase'
		| 'copyLastMessage'
		| 'toggleCodebase'
		| 'toggleHybridCompress'
		| 'toggleImageCompress'
		| 'toggleTeam'
		| 'toggleUltraTodo'
		| 'toggleSpeedometer'
		| 'showBranchPanel'
		| 'showDiffReviewPanel'
		| 'showConnectionPanel'
		| 'showTelemetryPanel'
		| 'showIdeSelectPanel'
		| 'sendAsMessage'
		| 'showNewPromptPanel'
		| 'showTaskManager'
		| 'forkSession'
		| 'btw'
		| 'interruptAndSend'
		| 'deepResearch'
		| 'startGoalLoop'
		// /goal resume 无参数 -> 打开 goal 会话列表面板
		| 'showGoalSessionPanel'
		| 'showGamesPanel'
		| 'quit'
		| 'disconnect'
		| 'pause'
		| 'resume';
	prompt?: string;
	sessionId?: string; // For /resume <sessionId> direct session loading
	location?: 'global' | 'project'; // For custom commands to specify location
	alreadyConnected?: boolean; // For /ide command to indicate if VSCode is already connected
	forceReindex?: boolean; // For /reindex -force to delete existing database and rebuild
	apiUrl?: string; // For /connect command to pass API URL
	exportFormat?: 'txt' | 'md' | 'html' | 'json'; // For /export command to choose output format
}

export interface CommandHandler {
	execute: (args?: string) => Promise<CommandResult> | CommandResult;
}

const commandHandlers: Record<string, CommandHandler> = {};

export function registerCommand(name: string, handler: CommandHandler): void {
	commandHandlers[name] = handler;
}

export async function executeCommand(
	commandName: string,
	args?: string,
): Promise<CommandResult> {
	const handler = commandHandlers[commandName];

	if (!handler) {
		// Unknown command should be sent as a normal message to AI
		return {
			success: true,
			action: 'sendAsMessage',
		};
	}

	try {
		const result = await handler.execute(args);
		return result;
	} catch (error) {
		return {
			success: false,
			message:
				error instanceof Error ? error.message : 'Command execution failed',
		};
	}
}
export function unregisterCommand(name: string): void {
	delete commandHandlers[name];
}

export function getAvailableCommands(): string[] {
	return Object.keys(commandHandlers);
}
