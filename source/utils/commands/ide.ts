import { registerCommand, type CommandResult } from '../commandExecutor.js';
import { vscodeConnection } from '../vscodeConnection.js';

// IDE connection command handler
registerCommand('ide', {
	execute: async (): Promise<CommandResult> => {
		// Check if server is already running in THIS process (allow multiple clients to connect)
		if (vscodeConnection.isServerRunning()) {
			const isConnected = vscodeConnection.isConnected();
			return {
				success: true,
				action: 'info',
				alreadyConnected: isConnected, // Add this flag to indicate connection status
				message: isConnected
					? `Connected to VSCode (server running on port ${vscodeConnection.getPort()})`
					: `VSCode connection server is running on port ${vscodeConnection.getPort()}\nWaiting for VSCode extension to connect...`
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
				// Port is in use by another Snow CLI process - this is OK!
				// Return success and indicate already connected
				return {
					success: true,
					action: 'info',
					alreadyConnected: true, // Treat as already connected since another terminal has the connection
					message: `VSCode connection is already active in another Snow CLI terminal.\nNo additional connection needed - context will be shared through VSCode extension.`
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
