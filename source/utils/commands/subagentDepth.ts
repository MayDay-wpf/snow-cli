import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getSubAgentMaxSpawnDepth,
	setSubAgentMaxSpawnDepth,
} from '../config/projectSettings.js';

registerCommand('subagent-depth', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();

		if (!trimmedArgs) {
			return {
				success: true,
				action: 'showSubAgentDepthPanel',
				message: 'Opening sub-agent depth panel',
			};
		}

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: `Sub-agent max spawn depth: ${getSubAgentMaxSpawnDepth()}`,
			};
		}

		const parsedDepth = Number.parseInt(trimmedArgs, 10);
		if (!Number.isInteger(parsedDepth) || parsedDepth < 0) {
			return {
				success: false,
				message:
					'Invalid depth. Usage: /subagent-depth [non-negative integer|status]',
			};
		}

		const normalizedDepth = setSubAgentMaxSpawnDepth(parsedDepth);
		return {
			success: true,
			message: `Sub-agent max spawn depth: ${normalizedDepth}`,
		};
	},
});

export default {};
