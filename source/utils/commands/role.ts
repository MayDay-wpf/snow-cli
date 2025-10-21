import { registerCommand, type CommandResult } from '../commandExecutor.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Role command handler - open or create ROLE.md file
registerCommand('role', {
	execute: async (): Promise<CommandResult> => {
		try {
			const cwd = process.cwd();
			const roleFilePath = path.join(cwd, 'ROLE.md');

			// Check if ROLE.md exists
			let fileExists = false;
			try {
				await fs.access(roleFilePath);
				fileExists = true;
			} catch {
				// File doesn't exist, create it
				await fs.writeFile(roleFilePath, '', 'utf-8');
			}

			// Open the file in the default editor
			const platform = process.platform;
			let command: string;

			if (platform === 'win32') {
				// Windows: use start command
				command = `start "" "${roleFilePath}"`;
			} else if (platform === 'darwin') {
				// macOS: use open command
				command = `open "${roleFilePath}"`;
			} else {
				// Linux: try xdg-open
				command = `xdg-open "${roleFilePath}"`;
			}

			try {
				await execAsync(command);
			} catch (error) {
				// If opening fails, just inform the user
				return {
					success: true,
					message: fileExists
						? `ROLE.md already exists at: ${roleFilePath}`
						: `Created ROLE.md at: ${roleFilePath}`,
				};
			}

			return {
				success: true,
				message: fileExists
					? `Opening ROLE.md from: ${roleFilePath}`
					: `Created and opening ROLE.md at: ${roleFilePath}`,
			};
		} catch (error) {
			return {
				success: false,
				message:
					error instanceof Error
						? error.message
						: 'Failed to handle ROLE.md file',
			};
		}
	},
});

export default {};
