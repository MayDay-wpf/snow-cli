/**
 * Built-in session-command tools (issue #190).
 * Agent-facing control plane for allowlisted slash/session commands.
 */

import {
	listSessionCommands,
	runSessionCommand,
} from '../utils/execution/sessionCommandPlane.js';

export const mcpTools = [
	{
		name: 'session-command-list',
		description:
			'List allowlisted Snow session/slash control-plane commands that agents may call (buddy, theme/simpleMode, yolo/plan status, mcp status, codebase, etc.). Returns risk tier and whether confirmation is required. Prefer this before session-command-run.',
		inputSchema: {
			type: 'object',
			properties: {
				risk: {
					type: 'string',
					enum: ['read', 'low_write', 'medium_write', 'high_risk'],
					description: 'Optional filter by risk tier.',
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: 'session-command-run',
		description:
			'Execute an allowlisted Snow session/slash control command without requiring the user to type /slash in the TUI. Examples: command="buddy.hatch" args with name/species; command="buddy" args="status"; command="tool-display" args="compact"; command="mcp" args="status". Medium/high risk writes require confirm=true. Returns stable JSON {ok, command, data, code, message}.',
		inputSchema: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description:
						'Command id or slash name, e.g. "buddy", "buddy.hatch", "yolo", "tool-display", "mcp".',
				},
				args: {
					type: 'string',
					description:
						'Optional args string, e.g. "hatch 小雪 --species=fox", "on", "compact", "status".',
				},
				confirm: {
					type: 'boolean',
					description:
						'Set true to confirm medium_write/high_risk commands (yolo on, profile switch, buddy reset, etc.).',
				},
			},
			required: ['command'],
			additionalProperties: false,
		},
	},
];

export async function executeSessionCommandTool(
	actualToolName: string,
	args: any,
): Promise<string> {
	switch (actualToolName) {
		case 'list': {
			const risk = args?.risk as string | undefined;
			let commands = listSessionCommands().map(item => ({
				id: item.id,
				command: item.command,
				subcommand: item.subcommand ?? null,
				risk: item.risk,
				description: item.description,
				headlessSupported: item.headlessSupported,
				requiresConfirm: Boolean(item.requiresConfirm),
			}));
			if (risk) {
				commands = commands.filter(c => c.risk === risk);
			}
			return JSON.stringify(
				{
					ok: true,
					command: 'session-command.list',
					data: {commands, total: commands.length},
				},
				null,
				2,
			);
		}
		case 'run': {
			const command = String(args?.command ?? '').trim();
			if (!command) {
				return JSON.stringify(
					{
						ok: false,
						code: 'INVALID_ARGS',
						message: 'command is required',
					},
					null,
					2,
				);
			}
			const result = await runSessionCommand({
				command,
				args:
					args?.args === undefined || args?.args === null
						? undefined
						: String(args.args),
				mode: 'agent',
				confirm: Boolean(args?.confirm),
			});
			return JSON.stringify(result, null, 2);
		}
		default:
			throw new Error(`Unknown session-command tool: ${actualToolName}`);
	}
}
