import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {connectionManager, type ConnectionConfig} from '../connection/ConnectionManager.js';

// Connect command handler - show connection panel for instance connection
registerCommand('connect', {
	execute: (args?: string): CommandResult => {
		// If args provided, try to parse as URL
		if (args?.trim()) {
			const url = args.trim();
			return {
				success: true,
				action: 'showConnectionPanel',
				apiUrl: url,
			};
		}

		// Show connection panel without pre-filled URL
		return {
			success: true,
			action: 'showConnectionPanel',
		};
	},
});

// Disconnect command handler
registerCommand('disconnect', {
	execute: async (): Promise<CommandResult> => {
		const result = await connectionManager.disconnect();
		return {
			success: result.success,
			message: result.message,
		};
	},
});

// Connection status command
registerCommand('connection-status', {
	execute: (): CommandResult => {
		const state = connectionManager.getState();
		let message = `Status: ${state.status}`;
		if (state.instanceId) {
			message += `\nInstance: ${state.instanceName || state.instanceId}`;
		}
		if (state.error) {
			message += `\nError: ${state.error}`;
		}
		return {
			success: true,
			message,
		};
	},
});

export {connectionManager, type ConnectionConfig};
export default {};
