import {
	isDangerousCommand,
	isSelfDestructiveCommand,
} from '../../mcp/utils/bash/security.utils.js';

export type PlanCommandPolicySettings = {
	allowedCommandPrefixes?: string[];
};

const BLOCKED_PLAN_CHECK_COMMANDS: RegExp[] = [
	/^\s*(?:cd|chdir|pushd|popd|set-location|push-location)\b/i,
	/\b(?:rm|rmdir|unlink|del|erase|remove-item)\b/i,
	/\bgit\s+(?:push|reset|clean|checkout|restore)\b/i,
	/\b(?:npm|pnpm|yarn)\s+publish\b/i,
	/\b(?:curl|wget|invoke-webrequest|invoke-restmethod)\b/i,
	/\b(?:shutdown|reboot|format-volume|diskpart|fdisk)\b/i,
	/\b(?:cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-(?:command|encodedcommand)|pwsh(?:\.exe)?\s+-(?:command|encodedcommand)|(?:ba|z|k|c)?sh\s+-c)\b/i,
];

function findUnquotedShellControl(command: string): string | null {
	let quote: 'single' | 'double' | null = null;
	for (let index = 0; index < command.length; index++) {
		const char = command[index]!;
		if (char === "'" && quote !== 'double') {
			quote = quote === 'single' ? null : 'single';
			continue;
		}

		if (char === '"' && quote !== 'single') {
			quote = quote === 'double' ? null : 'double';
			continue;
		}

		if (!quote && [';', '|', '&', '>', '<', '\n', '\r'].includes(char)) {
			return char;
		}

		if (char === '`' || (char === '$' && command[index + 1] === '(')) {
			return char === '`' ? '`' : '$(';
		}
	}

	return null;
}

export function validatePlanCheckCommand(
	command: string,
	settings: PlanCommandPolicySettings = {},
): string | null {
	const trimmed = command.trim();
	if (!trimmed) return 'command is empty';
	if (trimmed.length > 2048) return 'command exceeds 2048 characters';
	const control = findUnquotedShellControl(trimmed);
	if (control) {
		return `shell control operator ${JSON.stringify(
			control,
		)} is not allowed; split checks into separate command entries`;
	}

	if (isDangerousCommand(trimmed)) return 'dangerous shell command is blocked';
	const selfDestructive = isSelfDestructiveCommand(trimmed);
	if (selfDestructive.isSelfDestructive) {
		return selfDestructive.reason ?? 'self-destructive command is blocked';
	}

	if (BLOCKED_PLAN_CHECK_COMMANDS.some(pattern => pattern.test(trimmed))) {
		return 'mutating, network, publishing, or destructive commands are not allowed as acceptance checks';
	}

	const prefixes = settings.allowedCommandPrefixes?.filter(Boolean) ?? [];
	if (
		prefixes.length > 0 &&
		!prefixes.some(prefix => {
			const normalizedCommand = trimmed.toLowerCase();
			const normalizedPrefix = prefix.trim().toLowerCase();
			return (
				normalizedCommand === normalizedPrefix ||
				normalizedCommand.startsWith(`${normalizedPrefix} `)
			);
		})
	) {
		return 'command does not match planAcceptance.allowedCommandPrefixes';
	}

	return null;
}
