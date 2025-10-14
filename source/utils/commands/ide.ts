import { registerCommand, type CommandResult } from '../commandExecutor.js';
import { vscodeConnection } from '../vscodeConnection.js';

// IDE connection command handler
registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		// Check if already connected to IDE plugin
		if (vscodeConnection.isConnected()) {
			return {
				success: true,
				action: 'info',
				alreadyConnected: true,
				message: `Already connected to IDE (port ${vscodeConnection.getPort()})`
			};
		}

		// Try to connect to IDE plugin server
		try {
			await vscodeConnection.start();
			return {
				success: true,
				action: 'info',
				message: `Connected to IDE on port ${vscodeConnection.getPort()}\nMake sure your IDE plugin (VSCode/JetBrains) is active and running.`
			};
		} catch (error) {
			return {
				success: false,
				message: error instanceof Error
					? `Failed to connect to IDE: ${error.message}\nMake sure your IDE plugin is installed and active.`
					: 'Failed to connect to IDE. Make sure your IDE plugin is installed and active.'
			};
		}
	}
});

export default {};
