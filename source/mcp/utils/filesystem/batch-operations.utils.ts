/**
 * Batch operation utilities for filesystem operations
 */

import type {
	BatchOperationResult,
	BatchResultItem,
	EditBySearchConfig,
	EditByLineConfig,
} from '../../types/filesystem.types.js';

/**
 * Parse file path parameter into array format
 * Supports: string, string[], or array of config objects
 */
export function parseFilePathParameter<T extends {path: string}>(
	filePath: string | string[] | T[],
): Array<string | T> {
	if (Array.isArray(filePath)) {
		return filePath;
	}
	return [filePath];
}

/**
 * Extract file path from file item (string or object)
 */
export function extractFilePath<T extends {path: string}>(
	fileItem: string | T,
): string {
	return typeof fileItem === 'string' ? fileItem : fileItem.path;
}

/**
 * Parse edit by search parameters
 */
export function parseEditBySearchParams(
	fileItem: string | EditBySearchConfig,
	globalSearchContent?: string,
	globalReplaceContent?: string,
	globalOccurrence?: number,
): {
	path: string;
	searchContent: string;
	replaceContent: string;
	occurrence: number;
} {
	if (typeof fileItem === 'string') {
		if (!globalSearchContent || !globalReplaceContent) {
			throw new Error(
				'searchContent and replaceContent are required for string array format',
			);
		}
		return {
			path: fileItem,
			searchContent: globalSearchContent,
			replaceContent: globalReplaceContent,
			occurrence: globalOccurrence ?? 1,
		};
	}

	return {
		path: fileItem.path,
		searchContent: fileItem.searchContent,
		replaceContent: fileItem.replaceContent,
		occurrence: fileItem.occurrence ?? globalOccurrence ?? 1,
	};
}

/**
 * Parse edit by line parameters
 */
export function parseEditByLineParams(
	fileItem: string | EditByLineConfig,
	globalStartLine?: number,
	globalEndLine?: number,
	globalNewContent?: string,
): {
	path: string;
	startLine: number;
	endLine: number;
	newContent: string;
} {
	if (typeof fileItem === 'string') {
		if (
			globalStartLine === undefined ||
			globalEndLine === undefined ||
			globalNewContent === undefined
		) {
			throw new Error(
				'startLine, endLine, and newContent are required for string array format',
			);
		}
		return {
			path: fileItem,
			startLine: globalStartLine,
			endLine: globalEndLine,
			newContent: globalNewContent,
		};
	}

	return {
		path: fileItem.path,
		startLine: fileItem.startLine,
		endLine: fileItem.endLine,
		newContent: fileItem.newContent,
	};
}

/**
 * Execute batch operation with error handling
 */
export async function executeBatchOperation<
	TConfig,
	TSingleResult,
	TBatchItem extends BatchResultItem,
>(
	fileItems: Array<string | TConfig>,
	parseParams: (fileItem: string | TConfig) => any,
	executeSingle: (...params: any[]) => Promise<TSingleResult>,
	mapResult: (
		path: string,
		result: TSingleResult,
	) => Omit<TBatchItem, 'success' | 'error'>,
): Promise<BatchOperationResult<TBatchItem>> {
	const results: TBatchItem[] = [];

	for (const fileItem of fileItems) {
		try {
			const params = parseParams(fileItem);
			const result = await executeSingle(...Object.values(params));

			results.push({
				success: true,
				...(mapResult(params.path, result) as any),
			} as TBatchItem);
		} catch (error) {
			const filePath =
				typeof fileItem === 'string'
					? fileItem
					: (fileItem as {path: string}).path;
			results.push({
				path: filePath,
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			} as TBatchItem);
		}
	}

	const successCount = results.filter(r => r.success).length;
	const failureCount = results.filter(r => !r.success).length;

	// Build detailed message with all file diffs
	let detailedMessage = `📊 Batch Edit Summary: ${successCount} succeeded, ${failureCount} failed\n\n`;

	results.forEach((result, index) => {
		const num = index + 1;
		const separator = '─'.repeat(80);

		if (result.success) {
			detailedMessage += `${separator}\n`;
			detailedMessage += `✅ File ${num}/${results.length}: ${result.path}\n`;
			detailedMessage += `${separator}\n\n`;

			// Add individual file full result (including oldContent and newContent for diff)
			const fileResult = result as any;

			// Extract key metadata from message if available
			if (fileResult.message) {
				const lines = fileResult.message.split('\n');
				const metadataLines = lines.filter(
					(l: string) =>
						l.trim().startsWith('Matched:') ||
						l.trim().startsWith('Replaced:') ||
						l.trim().startsWith('Result:') ||
						l.trim().startsWith('📍'),
				);
				if (metadataLines.length > 0) {
					metadataLines.forEach((line: string) => {
						detailedMessage += `${line}\n`;
					});
					detailedMessage += '\n';
				}
			}

			// Add diff display - keep oldContent and newContent in results for UI rendering
			// Don't format as text here, let the UI handle it with DiffViewer
			if (fileResult.oldContent && fileResult.newContent) {
				// Just add a placeholder message, actual diff will be rendered by UI
				detailedMessage += `📊 Changes (lines ${
					fileResult.contextStartLine ?? '?'
				}-${fileResult.contextEndLine ?? '?'})\n\n`;
			}

			// Add structure analysis warnings if any
			if (fileResult.structureAnalysis) {
				const warnings: string[] = [];
				const sa = fileResult.structureAnalysis;

				if (!sa.bracketBalance?.curly?.balanced) {
					const diff =
						(sa.bracketBalance.curly.open || 0) -
						(sa.bracketBalance.curly.close || 0);
					warnings.push(
						`Curly brackets: ${
							diff > 0 ? `${diff} unclosed {` : `${Math.abs(diff)} extra }`
						}`,
					);
				}
				if (!sa.bracketBalance?.round?.balanced) {
					const diff =
						(sa.bracketBalance.round.open || 0) -
						(sa.bracketBalance.round.close || 0);
					warnings.push(
						`Round brackets: ${
							diff > 0 ? `${diff} unclosed (` : `${Math.abs(diff)} extra )`
						}`,
					);
				}
				if (!sa.bracketBalance?.square?.balanced) {
					const diff =
						(sa.bracketBalance.square.open || 0) -
						(sa.bracketBalance.square.close || 0);
					warnings.push(
						`Square brackets: ${
							diff > 0 ? `${diff} unclosed [` : `${Math.abs(diff)} extra ]`
						}`,
					);
				}

				if (warnings.length > 0) {
					detailedMessage += `⚠️  Structure Warnings:\n`;
					warnings.forEach((w: string) => {
						detailedMessage += `   • ${w}\n`;
					});
					detailedMessage += '\n';
				}
			}

			// Add diagnostics if any
			if (fileResult.diagnostics && fileResult.diagnostics.length > 0) {
				const errorCount = fileResult.diagnostics.filter(
					(d: any) => d.severity === 'error',
				).length;
				const warningCount = fileResult.diagnostics.filter(
					(d: any) => d.severity === 'warning',
				).length;

				if (errorCount > 0 || warningCount > 0) {
					detailedMessage += `🔧 Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)\n`;
					fileResult.diagnostics.slice(0, 3).forEach((d: any) => {
						const icon = d.severity === 'error' ? '❌' : '⚠️';
						detailedMessage += `   ${icon} Line ${d.line}: ${d.message}\n`;
					});
					if (fileResult.diagnostics.length > 3) {
						detailedMessage += `   ... and ${
							fileResult.diagnostics.length - 3
						} more\n`;
					}
					detailedMessage += '\n';
				}
			}
		} else {
			detailedMessage += `${separator}\n`;
			detailedMessage += `❌ File ${num}/${results.length}: ${result.path}\n`;
			detailedMessage += `${separator}\n`;
			detailedMessage += `Error: ${result.error}\n\n`;
		}
	});

	return {
		message: detailedMessage.trim(),
		results,
		totalFiles: fileItems.length,
		successCount,
		failureCount,
	};
}
