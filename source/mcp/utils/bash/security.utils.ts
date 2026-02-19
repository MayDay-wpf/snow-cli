/**
 * Security utilities for terminal command execution
 */

/**
 * Dangerous command patterns that should be blocked
 */
export const DANGEROUS_PATTERNS = [
	/rm\s+-rf\s+\/[^/\s]*/i, // rm -rf / or /path
	/>\s*\/dev\/sda/i, // writing to disk devices
	/mkfs/i, // format filesystem
	/dd\s+if=/i, // disk operations
];

/**
 * Check if a command contains dangerous patterns
 * @param command - Command to check
 * @returns true if command is dangerous
 */
export function isDangerousCommand(command: string): boolean {
	return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Self-protection: detect commands that would kill the CLI's own Node.js process.
 *
 * Since this CLI runs as a Node.js process, any command that terminates
 * Node.js processes by name (e.g. Stop-Process, taskkill, killall, pkill)
 * will also kill the CLI itself, causing an abrupt crash.
 */
export function isSelfDestructiveCommand(command: string): {
	isSelfDestructive: boolean;
	reason?: string;
	suggestion?: string;
} {
	const lower = command.toLowerCase();
	const cliPid = process.pid;

	// PowerShell: Stop-Process targeting node processes
	if (lower.includes('stop-process') && /\bnode\b/i.test(command)) {
		return {
			isSelfDestructive: true,
			reason: 'Command would terminate Node.js processes, including this CLI itself',
			suggestion:
				`This CLI is running as Node.js (PID: ${cliPid}). ` +
				`Add a PID exclusion filter, e.g.: Where-Object { ... -and $_.Id -ne ${cliPid} }`,
		};
	}

	// Windows CMD: taskkill targeting node.exe
	if (/\btaskkill\b/i.test(command) && /\bnode(\.exe)?\b/i.test(command)) {
		return {
			isSelfDestructive: true,
			reason: 'Command would terminate node.exe processes, including this CLI itself',
			suggestion:
				`This CLI is running as node.exe (PID: ${cliPid}). ` +
				`Use "taskkill /PID <target_pid>" for specific processes, excluding PID ${cliPid}.`,
		};
	}

	// Unix: killall node
	if (/\bkillall\s+(-\w+\s+)*node\b/i.test(command)) {
		return {
			isSelfDestructive: true,
			reason: 'killall node would terminate ALL Node.js processes, including this CLI',
			suggestion: `Use "kill <specific_pid>" to target individual processes, excluding PID ${cliPid}.`,
		};
	}

	// Unix: pkill node / pkill -f node
	if (/\bpkill\s+(-\w+\s+)*node\b/i.test(command)) {
		return {
			isSelfDestructive: true,
			reason: 'pkill node would terminate Node.js processes, including this CLI',
			suggestion: `Use "kill <specific_pid>" to target individual processes, excluding PID ${cliPid}.`,
		};
	}

	// Any platform: directly targeting the CLI's own PID
	const pidPatterns = [
		new RegExp(`\\bkill\\s+(-\\d+\\s+)*${cliPid}\\b`),
		new RegExp(`\\bStop-Process\\s+.*-Id\\s+${cliPid}\\b`, 'i'),
		new RegExp(`\\btaskkill\\b.*\\/PID\\s+${cliPid}\\b`, 'i'),
	];
	if (pidPatterns.some(p => p.test(command))) {
		return {
			isSelfDestructive: true,
			reason: `Command directly targets this CLI process (PID: ${cliPid})`,
			suggestion: `PID ${cliPid} is the Snow CLI process. Killing it will terminate the current session.`,
		};
	}

	return {isSelfDestructive: false};
}

/**
 * Truncate output if it exceeds maximum length
 * @param output - Output string to truncate
 * @param maxLength - Maximum allowed length
 * @returns Truncated output with indicator if truncated
 */
export function truncateOutput(output: string, maxLength: number): string {
	if (!output) return '';
	if (output.length > maxLength) {
		return output.slice(0, maxLength) + '\n... (output truncated)';
	}
	return output;
}
