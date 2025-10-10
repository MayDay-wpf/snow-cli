import { registerCommand, type CommandResult } from '../commandExecutor.js';
import { vscodeConnection } from '../vscodeConnection.js';

// IDE connection command handler
registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		// Check if already connected
		if (vscodeConnection.isConnected()) {
			return {
				success: true,
				action: 'info',
				message: 'Already connected to VSCode editor'
			};
		}

		// Check if server is already running (but not connected yet)
		if (vscodeConnection.isServerRunning()) {
			return {
				success: true,
				action: 'info',
				message: `VSCode connection server is already running on port ${vscodeConnection.getPort()}\nWaiting for VSCode extension to connect...`
			};
		}

		// Start the server
		try {
			await vscodeConnection.start();
			return {
				success: true,
				action: 'info',
				message: `VSCode connection server started on port ${vscodeConnection.getPort()}\nWaiting for VSCode extension to connect...`
			};
		} catch (error) {
			// Handle EADDRINUSE error specifically
			if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE') {
				return {
					success: false,
					message: `Port ${vscodeConnection.getPort()} is already in use. Please restart Snow CLI to reset the connection.`
				};
			}
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Failed to start IDE connection'
			};
		}
	}
});

export default {};
