import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

// Telemetry command handler - opens OpenTelemetry configuration panel
registerCommand('telemetry', {
	execute: (): CommandResult => {
		return {
			success: true,
			action: 'showTelemetryPanel',
			message: 'Opening OpenTelemetry telemetry configuration panel',
		};
	},
});

export default {};
