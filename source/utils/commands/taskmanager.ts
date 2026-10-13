import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';

// Task manager command handler - opens the resource manager panel.
// Shows Snow CLI resource usage (main process CPU / memory plus running
// sub-agents, teammates, MCP/LSP child processes and background processes)
// and lets the user stop individual processes, similar to a browser's
// built-in task manager.
registerCommand('taskmanager', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showResourceManager',
		};
	},
});

export default {};
