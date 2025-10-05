import { registerCommand, type CommandResult } from '../commandExecutor.js';

// MCP info command handler
registerCommand('mcp', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showMcpInfo',
			message: 'Opening MCP services overview'
		};
	}
});

export default {};
