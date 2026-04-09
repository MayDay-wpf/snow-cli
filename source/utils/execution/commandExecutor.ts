export interface CommandResult {
	success: boolean;
	message?: string;
	action?:
		| 'clear'
		| 'resume'
		| 'info'
		| 'showMcpInfo'
		| 'toggleYolo'
		| 'togglePlan'
		| 'toggleVulnerabilityHunting'
		| 'toggleToolSearch'
		| 'initProject'
		| 'compact'
		| 'showSessionPanel'
		| 'showMcpPanel'
		| 'showUsagePanel'
		| 'showBackgroundPanel'
		| 'showWorkingDirPanel'
		| 'home'
		| 'review'
		| 'showReviewCommitPanel'
		| 'exportChat'
		| 'showAgentPicker'
		| 'showTodoPicker'
		| 'showTodoListPanel'
		| 'showProfilePanel'
		| 'showModelsPanel'
		| 'showSubAgentDepthPanel'
		| 'showSkillsPicker'
		| 'showGitLinePicker'
		| 'help'
		| 'showCustomCommandConfig'
		| 'executeCustomCommand'
		| 'executeTerminalCommand'
		| 'deleteCustomCommand'
		| 'showSkillsCreation'
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
		| 'toggleTeam'
		| 'showBranchPanel'
		| 'showDiffReviewPanel'
		| 'showConnectionPanel'
		| 'sendAsMessage'
		| 'showNewPromptPanel'
		| 'showTaskManager'
		| 'btw'
		| 'quit';
	prompt?: string;
	sessionId?: string; // For /resume <sessionId> direct session loading
	location?: 'global' | 'project'; // For custom commands to specify location
	alreadyConnected?: boolean; // For /ide command to indicate if VSCode is already connected
	forceReindex?: boolean; // For /reindex -force to delete existing database and rebuild
	apiUrl?: string; // For /connect command to pass API URL
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
