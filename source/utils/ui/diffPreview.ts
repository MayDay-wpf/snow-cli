import fs from 'fs';

/**
 * Read the original content of a file, returning null if the file
 * does not exist or cannot be read.
 */
export function readOriginalFile(filePath: string): string | null {
	try {
		if (!filePath || !fs.existsSync(filePath)) return null;
		return fs.readFileSync(filePath, 'utf-8');
	} catch {
		return null;
	}
}

/**
 * Compute a preview of the file content after applying hashline edit operations.
 *
 * This mirrors the logic in ToolConfirmation.tsx's `computeHashlinePreview`.
 * Operations are sorted by startLine descending so that line offsets remain
 * stable as earlier operations are applied.
 */
export function computeHashlinePreview(
	originalContent: string,
	operations: any[],
): string {
	if (!Array.isArray(operations) || operations.length === 0) {
		return originalContent;
	}
	const mutableLines = originalContent.split('\n');
	const parsed = operations
		.map((op: any) => {
			const startMatch = String(op.startAnchor ?? '').match(/^(\d+):/);
			const endMatch = String(op.endAnchor ?? '').match(/^(\d+):/);
			return {
				type: op.type as string,
				content: (op.content ?? '') as string,
				startLine: startMatch ? parseInt(startMatch[1]!, 10) : 0,
				endLine: endMatch ? parseInt(endMatch[1]!, 10) : 0,
			};
		})
		.filter(op => op.startLine > 0 && op.endLine > 0)
		.sort((a, b) => b.startLine - a.startLine);

	for (const op of parsed) {
		const newLines = op.content.split('\n');
		switch (op.type) {
			case 'replace':
				mutableLines.splice(
					op.startLine - 1,
					op.endLine - op.startLine + 1,
					...newLines,
				);
				break;
			case 'insert_after':
				mutableLines.splice(op.startLine, 0, ...newLines);
				break;
			case 'delete':
				mutableLines.splice(op.startLine - 1, op.endLine - op.startLine + 1);
				break;
		}
	}
	return mutableLines.join('\n');
}

/**
 * Compute a preview of the file content after applying a search-and-replace
 * edit operation.
 *
 * This mirrors the logic in ToolConfirmation.tsx's `computeReplaceEditPreview`.
 */
export function computeReplaceEditPreview(
	originalContent: string,
	searchContent: string,
	replaceContent: string,
): string {
	const idx = originalContent.indexOf(searchContent);
	if (idx !== -1) {
		return (
			originalContent.substring(0, idx) +
			replaceContent +
			originalContent.substring(idx + searchContent.length)
		);
	}
	return originalContent;
}

export interface DiffPreviewEntry {
	filePath: string;
	oldContent: string;
	newContent: string;
}

/**
 * Collect diff preview entries for a given filesystem tool call.
 *
 * Supports `filesystem-edit` (hashline), `filesystem-replaceedit`, and
 * `filesystem-create` — both single-file and batch (array filePath) modes.
 *
 * @param toolName - The tool function name (e.g. 'filesystem-edit')
 * @param toolArgs - The raw JSON arguments string from the tool call
 * @returns Array of diff preview entries with oldContent/newContent, or
 *          empty array if the tool/files could not be processed.
 */
export function collectDiffPreviewEntries(
	toolName: string,
	toolArgs: string,
): DiffPreviewEntry[] {
	const entries: DiffPreviewEntry[] = [];
	try {
		const parsed = JSON.parse(toolArgs);

		if (toolName === 'filesystem-edit' && parsed.filePath) {
			if (typeof parsed.filePath === 'string') {
				const originalContent = readOriginalFile(parsed.filePath);
				if (originalContent !== null) {
					const newContent = computeHashlinePreview(
						originalContent,
						parsed.operations,
					);
					entries.push({
						filePath: parsed.filePath,
						oldContent: originalContent,
						newContent,
					});
				}
			} else if (Array.isArray(parsed.filePath)) {
				for (const item of parsed.filePath) {
					if (
						item &&
						typeof item === 'object' &&
						typeof item.path === 'string'
					) {
						const originalContent = readOriginalFile(item.path);
						if (originalContent !== null) {
							const newContent = computeHashlinePreview(
								originalContent,
								item.operations,
							);
							entries.push({
								filePath: item.path,
								oldContent: originalContent,
								newContent,
							});
						}
					}
				}
			}
		}

		if (toolName === 'filesystem-replaceedit' && parsed.filePath) {
			if (typeof parsed.filePath === 'string') {
				const originalContent = readOriginalFile(parsed.filePath);
				if (originalContent !== null) {
					const newContent =
						parsed.searchContent && parsed.replaceContent !== undefined
							? computeReplaceEditPreview(
									originalContent,
									parsed.searchContent,
									parsed.replaceContent,
							  )
							: originalContent;
					entries.push({
						filePath: parsed.filePath,
						oldContent: originalContent,
						newContent,
					});
				}
			} else if (Array.isArray(parsed.filePath)) {
				for (const item of parsed.filePath) {
					if (typeof item === 'string') {
						const originalContent = readOriginalFile(item);
						if (originalContent !== null) {
							const newContent =
								parsed.searchContent && parsed.replaceContent !== undefined
									? computeReplaceEditPreview(
											originalContent,
											parsed.searchContent,
											parsed.replaceContent,
									  )
									: originalContent;
							entries.push({
								filePath: item,
								oldContent: originalContent,
								newContent,
							});
						}
					} else if (
						item &&
						typeof item === 'object' &&
						typeof item.path === 'string'
					) {
						const originalContent = readOriginalFile(item.path);
						if (originalContent !== null) {
							const search = item.searchContent ?? parsed.searchContent;
							const replace = item.replaceContent ?? parsed.replaceContent;
							const newContent =
								search && replace !== undefined
									? computeReplaceEditPreview(originalContent, search, replace)
									: originalContent;
							entries.push({
								filePath: item.path,
								oldContent: originalContent,
								newContent,
							});
						}
					}
				}
			}
		}

		if (toolName === 'filesystem-create' && parsed.filePath && parsed.content) {
			if (typeof parsed.filePath === 'string') {
				const originalContent = readOriginalFile(parsed.filePath) ?? '';
				entries.push({
					filePath: parsed.filePath,
					oldContent: originalContent,
					newContent: parsed.content,
				});
			}
		}
	} catch {
		// Ignore parse errors
	}
	return entries;
}

/**
 * For single-file filesystem-edit/replaceedit calls, compute oldContent and
 * newContent for the pending DiffViewer display.
 *
 * Returns the enriched arguments object, or the original arguments if diff
 * preview could not be computed.
 */
export function enrichPendingEditArgs(
	toolName: string,
	toolArgs: Record<string, any>,
): Record<string, any> {
	if (toolName !== 'filesystem-edit' && toolName !== 'filesystem-replaceedit') {
		return toolArgs;
	}

	// Only enrich single-file (non-batch) calls — batch calls use
	// batchResults which are populated after execution.
	if (toolArgs['isBatch'] || Array.isArray(toolArgs['filePath'])) {
		return toolArgs;
	}

	const entries = collectDiffPreviewEntries(toolName, JSON.stringify(toolArgs));

	if (entries.length === 1) {
		const entry = entries[0]!;
		return {
			...toolArgs,
			oldContent: entry.oldContent,
			newContent: entry.newContent,
			filename: entry.filePath,
		};
	}

	return toolArgs;
}
