import {vscodeConnection, type Diagnostic} from '../utils/vscodeConnection.js';

/**
 * IDE Diagnostics MCP Service
 * Provides access to diagnostics (errors, warnings, hints) from connected IDE
 * Supports both VSCode and JetBrains IDEs
 */
export class IdeDiagnosticsMCPService {
	/**
	 * Get diagnostics for a specific file from the connected IDE
	 * @param filePath - Absolute path to the file to get diagnostics for
	 * @returns Promise that resolves with array of diagnostics
	 */
	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		if (!vscodeConnection.isConnected()) {
			throw new Error(
				'IDE connection not available. Please ensure VSCode or JetBrains IDE plugin is installed and running.',
			);
		}

		try {
			const diagnostics = await vscodeConnection.requestDiagnostics(filePath);
			return diagnostics;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Unknown error';
			throw new Error(`Failed to get diagnostics: ${message}`);
		}
	}

	/**
	 * Format diagnostics into human-readable text
	 * @param diagnostics - Array of diagnostics to format
	 * @param filePath - Path to the file (for display)
	 * @returns Formatted string
	 */
	formatDiagnostics(diagnostics: Diagnostic[], filePath: string): string {
		if (diagnostics.length === 0) {
			return `No diagnostics found for ${filePath}`;
		}

		const lines: string[] = [`Diagnostics for ${filePath}:\n`];

		// Group by severity
		const grouped = {
			error: diagnostics.filter(d => d.severity === 'error'),
			warning: diagnostics.filter(d => d.severity === 'warning'),
			info: diagnostics.filter(d => d.severity === 'info'),
			hint: diagnostics.filter(d => d.severity === 'hint'),
		};

		// Add summary
		const counts = [
			grouped.error.length > 0 ? `${grouped.error.length} errors` : null,
			grouped.warning.length > 0
				? `${grouped.warning.length} warnings`
				: null,
			grouped.info.length > 0 ? `${grouped.info.length} info` : null,
			grouped.hint.length > 0 ? `${grouped.hint.length} hints` : null,
		].filter(Boolean);

		lines.push(`Total: ${counts.join(', ')}\n`);

		// Format each severity group
		const formatGroup = (
			items: Diagnostic[],
			label: string,
			icon: string,
		) => {
			if (items.length === 0) return;

			lines.push(`\n${label}:`);
			items.forEach(d => {
				const location = `Line ${d.line + 1}, Col ${d.character + 1}`;
				const source = d.source ? ` [${d.source}]` : '';
				const code = d.code ? ` (${d.code})` : '';
				lines.push(`  ${icon} ${location}${source}${code}`);
				lines.push(`    ${d.message}`);
			});
		};

		formatGroup(grouped.error, 'Errors', '❌');
		formatGroup(grouped.warning, 'Warnings', '⚠️');
		formatGroup(grouped.info, 'Info', 'ℹ️');
		formatGroup(grouped.hint, 'Hints', '💡');

		return lines.join('\n');
	}
}

// Export a default instance
export const ideDiagnosticsService = new IdeDiagnosticsMCPService();

// Export MCP tool definitions
export const mcpTools = [
	{
		name: 'ide_get_diagnostics',
		description:
			'🔍 Get diagnostics (errors, warnings, hints) for a specific file from the connected IDE. Works with both VSCode and JetBrains IDEs. Returns array of diagnostic information including severity, line number, character position, message, and source. Requires IDE plugin to be installed and running.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description:
						'Absolute path to the file to get diagnostics for. Must be a valid file path accessible by the IDE.',
				},
			},
			required: ['filePath'],
		},
	},
];
