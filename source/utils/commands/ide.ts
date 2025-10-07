import { registerCommand, type CommandResult } from '../commandExecutor.js';
import { vscodeConnection } from '../vscodeConnection.js';

// IDE connection command handler
registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		if (vscodeConnection.isConnected()) {
			return {
				success: true,
				action: 'info',
				message: 'Already connected to VSCode editor'
			};
		}

		try {
			await vscodeConnection.start();
			return {
				success: true,
				action: 'info',
				message: `VSCode connection server started on port ${vscodeConnection.getPort()}\nPlease connect from the Snow CLI extension in VSCode`
			};
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Failed to start IDE connection'
			};
		}
	}
});

export default {};
