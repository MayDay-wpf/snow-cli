import { registerCommand, type CommandResult } from '../execution/commandExecutor.js';

// MCP info command handler - shows MCP panel in chat
registerCommand('mcp', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showMcpPanel',
			message: 'Showing MCP services panel'
		};
	}
});

export default {};
