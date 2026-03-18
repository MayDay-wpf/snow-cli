import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getAutoFormatEnabled,
	setAutoFormatEnabled,
} from '../config/projectSettings.js';

// Auto-format command handler - toggle MCP filesystem auto-formatting
// Usage:
//   /auto-format        - Toggle auto-format on/off
//   /auto-format on     - Enable auto-format
//   /auto-format off    - Disable auto-format
//   /auto-format status - Show current status
registerCommand('auto-format', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const enabled = getAutoFormatEnabled();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: `Auto-format: ${enabled ? 'Enabled' : 'Disabled'} for this project`,
			};
		}

		if (trimmedArgs === 'on') {
			setAutoFormatEnabled(true);
			return {
				success: true,
				message: 'Auto-format: Enabled for this project',
			};
		}

		if (trimmedArgs === 'off') {
			setAutoFormatEnabled(false);
			return {
				success: true,
				message: 'Auto-format: Disabled for this project',
			};
		}

		setAutoFormatEnabled(!enabled);
		return {
			success: true,
			message: `Auto-format: ${!enabled ? 'Enabled' : 'Disabled'} for this project`,
		};
	},
});

export default {};
