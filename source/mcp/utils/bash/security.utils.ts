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
