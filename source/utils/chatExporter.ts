import * as fs from 'fs/promises';
import type { Message } from '../ui/components/MessageList.js';

/**
 * Format messages to plain text for export
 */
export function formatMessagesAsText(messages: Message[]): string {
	const lines: string[] = [];
	const timestamp = new Date().toISOString();

	// Add header
	lines.push('=====================================');
	lines.push('Snow AI - Chat Export');
	lines.push(`Exported at: ${new Date(timestamp).toLocaleString()}`);
	lines.push('=====================================');
	lines.push('');

	// Format each message
	for (const message of messages) {
		// Skip command messages
		if (message.role === 'command') {
			continue;
		}

		// Add role header
		let roleLabel = '';
		if (message.role === 'user') {
			roleLabel = 'USER';
		} else if (message.role === 'assistant') {
			roleLabel = 'ASSISTANT';
		} else if (message.role === 'subagent') {
			roleLabel = 'SUBAGENT';
		} else {
			roleLabel = 'UNKNOWN';
		}

		lines.push(`[${roleLabel}]`);
		lines.push('-'.repeat(40));

		// Add content (Message.content is always string based on the type definition)
		lines.push(message.content);

		// Add tool call information if present
		if (message.toolCall) {
			lines.push('');
			lines.push(`[TOOL CALL: ${message.toolCall.name}]`);
			try {
				const argsStr = typeof message.toolCall.arguments === 'string'
					? message.toolCall.arguments
					: JSON.stringify(message.toolCall.arguments, null, 2);
				lines.push(argsStr);
			} catch {
				lines.push(String(message.toolCall.arguments));
			}
		}

		// Add tool display information if present
		if (message.toolDisplay) {
			lines.push('');
			lines.push(`[TOOL: ${message.toolDisplay.toolName}]`);
			for (const arg of message.toolDisplay.args) {
				lines.push(`  ${arg.key}: ${arg.value}`);
			}
		}

		// Add tool result if present
		if (message.toolResult) {
			lines.push('');
			lines.push('[TOOL RESULT]');
			try {
				const result = JSON.parse(message.toolResult);
				lines.push(JSON.stringify(result, null, 2));
			} catch {
				lines.push(message.toolResult);
			}
		}

		// Add terminal result if present
		if (message.terminalResult) {
			lines.push('');
			if (message.terminalResult.command) {
				lines.push(`[COMMAND: ${message.terminalResult.command}]`);
			}
			if (message.terminalResult.stdout) {
				lines.push('[STDOUT]');
				lines.push(message.terminalResult.stdout);
			}
			if (message.terminalResult.stderr) {
				lines.push('[STDERR]');
				lines.push(message.terminalResult.stderr);
			}
			if (message.terminalResult.exitCode !== undefined) {
				lines.push(`[EXIT CODE: ${message.terminalResult.exitCode}]`);
			}
		}

		// Add images information if present
		if (message.images && message.images.length > 0) {
			lines.push('');
			lines.push(`[${message.images.length} image(s) attached]`);
		}

		// Add files information if present
		if (message.files && message.files.length > 0) {
			lines.push('');
			lines.push(`[${message.files.length} file(s) referenced]`);
			for (const file of message.files) {
				lines.push(`  - ${file.path}`);
			}
		}

		lines.push('');
		lines.push('');
	}

	// Add footer
	lines.push('=====================================');
	lines.push('End of Chat Export');
	lines.push('=====================================');

	return lines.join('\n');
}

/**
 * Export messages to a file
 */
export async function exportMessagesToFile(
	messages: Message[],
	filePath: string
): Promise<void> {
	const textContent = formatMessagesAsText(messages);
	await fs.writeFile(filePath, textContent, 'utf-8');
}
