import fs from 'fs';
import {calculateSimilarity} from '../../mcp/utils/filesystem/similarity.utils.js';

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

	const hashlineContentRe = /^\s*\d+:[0-9a-fA-F]{2}→/;
	const sanitizeContent = (raw: string): string => {
		const contentLines = raw.split('\n');
		const hasHashlines =
			contentLines.length > 0 &&
			contentLines.every(line => line === '' || hashlineContentRe.test(line));
		if (!hasHashlines) return raw;
		return contentLines
			.map(line => line.replace(hashlineContentRe, ''))
			.join('\n');
	};

	for (const op of parsed) {
		const newLines = sanitizeContent(op.content).split('\n');
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
	occurrence: number = 1,
): string {
	const normalizedSearch = searchContent
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
	const normalizedContent = originalContent
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
	const searchLines = normalizedSearch.split('\n');
	const contentLines = normalizedContent.split('\n');

	if (searchLines.length === 0 || contentLines.length < searchLines.length) {
		return originalContent;
	}

	const matches: Array<{
		startLine: number;
		endLine: number;
		similarity: number;
	}> = [];
	const threshold = 0.85;
	const usePreFilter = searchLines.length >= 5;

	for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
		if (usePreFilter) {
			const firstLineSimilarity = calculateSimilarity(
				searchLines[0]?.replace(/\s+/g, ' ').trim() || '',
				contentLines[i]?.replace(/\s+/g, ' ').trim() || '',
				0.2,
			);
			if (firstLineSimilarity < 0.2) continue;
		}

		const similarity = calculateSimilarity(
			normalizedSearch,
			contentLines.slice(i, i + searchLines.length).join('\n'),
			threshold,
		);
		if (similarity >= threshold) {
			matches.push({
				startLine: i + 1,
				endLine: i + searchLines.length,
				similarity,
			});
		}
	}

	matches.sort((a, b) => b.similarity - a.similarity);
	const selectedMatch =
		occurrence === -1 && matches.length === 1
			? matches[0]
			: occurrence > 0
			? matches[occurrence - 1]
			: undefined;
	if (!selectedMatch) return originalContent;

	const replaceLines = replaceContent
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n');
	const originalFirstLine =
		originalContent.split('\n')[selectedMatch.startLine - 1];
	const originalIndent = originalFirstLine?.match(/^(\s*)/)?.[1] || '';
	const replaceFirstLine = replaceLines[0];
	const replaceIndent = replaceFirstLine?.match(/^(\s*)/)?.[1] || '';
	if (originalIndent !== replaceIndent && replaceFirstLine) {
		replaceLines[0] = originalIndent + replaceFirstLine.trim();
	}

	return [
		...originalContent.split('\n').slice(0, selectedMatch.startLine - 1),
		...replaceLines,
		...originalContent.split('\n').slice(selectedMatch.endLine),
	].join('\n');
}

export interface DiffPreviewEntry {
	filePath: string;
	oldContent: string;
	newContent: string;
}

/** Resolve a 1-indexed target line into a 0-based insertion index (preview). */
function previewResolveInsertIndex(
	targetLine: unknown,
	position: string,
	lineCount: number,
): number {
	if (typeof targetLine !== 'number' || !Number.isInteger(targetLine)) {
		return lineCount;
	}
	if (targetLine < 1) {
		return 0;
	}
	const index = position === 'after' ? targetLine : targetLine - 1;
	return Math.max(0, Math.min(lineCount, index));
}

/**
 * Compute diff preview entries for a `filesystem-copy` call (copy/cut of a
 * line-range segment). Mirrors the server-side algorithm so the pending
 * DiffViewer matches the executed result. Local paths only — remote (ssh://)
 * paths are skipped because their content cannot be read synchronously.
 */
function computeCopySegmentPreviewEntries(parsed: any): DiffPreviewEntry[] {
	const entries: DiffPreviewEntry[] = [];
	if (typeof parsed.filePath !== 'string') {
		return entries;
	}
	if (
		!Number.isInteger(parsed.startLine) ||
		!Number.isInteger(parsed.endLine)
	) {
		return entries;
	}
	const sourceContent = readOriginalFile(parsed.filePath);
	if (sourceContent === null) {
		return entries;
	}
	const sourceLines = sourceContent.split('\n');
	const startLine = Math.max(1, parsed.startLine);
	const endLine = Math.min(parsed.endLine, sourceLines.length);
	if (startLine > endLine) {
		return entries;
	}
	const segment = sourceLines.slice(startLine - 1, endLine);
	const mode = parsed.mode === 'cut' ? 'cut' : 'copy';
	const position = parsed.position === 'before' ? 'before' : 'after';
	const targetPath =
		typeof parsed.targetPath === 'string' ? parsed.targetPath : parsed.filePath;

	if (targetPath === parsed.filePath) {
		const anchor = previewResolveInsertIndex(
			parsed.targetLine,
			position,
			sourceLines.length,
		);
		let newLines: string[];
		if (mode === 'cut') {
			const remaining = [
				...sourceLines.slice(0, startLine - 1),
				...sourceLines.slice(endLine),
			];
			let idx = anchor;
			if (idx >= endLine) {
				idx -= segment.length;
			}
			idx = Math.max(0, Math.min(remaining.length, idx));
			newLines = [
				...remaining.slice(0, idx),
				...segment,
				...remaining.slice(idx),
			];
		} else {
			const idx = Math.max(0, Math.min(sourceLines.length, anchor));
			newLines = [
				...sourceLines.slice(0, idx),
				...segment,
				...sourceLines.slice(idx),
			];
		}
		entries.push({
			filePath: parsed.filePath,
			oldContent: sourceContent,
			newContent: newLines.join('\n'),
		});
		return entries;
	}

	const targetContent = readOriginalFile(targetPath);
	const targetLines = targetContent !== null ? targetContent.split('\n') : [];
	const idx = previewResolveInsertIndex(
		parsed.targetLine,
		position,
		targetLines.length,
	);
	const newTargetLines = [
		...targetLines.slice(0, idx),
		...segment,
		...targetLines.slice(idx),
	];

	if (mode === 'cut') {
		const remaining = [
			...sourceLines.slice(0, startLine - 1),
			...sourceLines.slice(endLine),
		];
		entries.push({
			filePath: parsed.filePath,
			oldContent: sourceContent,
			newContent: remaining.join('\n'),
		});
	}

	entries.push({
		filePath: targetPath,
		oldContent: targetContent ?? '',
		newContent: newTargetLines.join('\n'),
	});
	return entries;
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

		// Normalize filePath: some AI models return filePath as a JSON string
		// (e.g. "[{\"path\":\"...\",\"content\":\"...\"}]") instead of a real
		// array. Parse it so downstream logic can treat it as an array.
		if (
			typeof parsed.filePath === 'string' &&
			parsed.filePath.trimStart().startsWith('[')
		) {
			try {
				parsed.filePath = JSON.parse(parsed.filePath);
			} catch {
				// Not valid JSON — leave as-is (single file path string)
			}
		}

		if (toolName === 'filesystem-copy') {
			entries.push(...computeCopySegmentPreviewEntries(parsed));
			return entries;
		}

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
					if (typeof item === 'string') {
						const originalContent = readOriginalFile(item);
						if (originalContent !== null) {
							const newContent = computeHashlinePreview(
								originalContent,
								parsed.operations,
							);
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
							const newContent = computeHashlinePreview(
								originalContent,
								item.operations ?? parsed.operations,
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
						typeof parsed.searchContent === 'string' &&
						parsed.replaceContent !== undefined
							? computeReplaceEditPreview(
									originalContent,
									parsed.searchContent,
									parsed.replaceContent,
									parsed.occurrence,
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
								typeof parsed.searchContent === 'string' &&
								parsed.replaceContent !== undefined
									? computeReplaceEditPreview(
											originalContent,
											parsed.searchContent,
											parsed.replaceContent,
											parsed.occurrence,
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
								typeof search === 'string' && replace !== undefined
									? computeReplaceEditPreview(
											originalContent,
											search,
											replace,
											item.occurrence ?? parsed.occurrence,
									  )
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

		if (toolName === 'filesystem-create' && parsed.filePath) {
			if (typeof parsed.filePath === 'string' && parsed.content) {
				const originalContent = readOriginalFile(parsed.filePath) ?? '';
				entries.push({
					filePath: parsed.filePath,
					oldContent: originalContent,
					newContent: parsed.content,
				});
			} else if (Array.isArray(parsed.filePath)) {
				for (const item of parsed.filePath) {
					if (
						item &&
						typeof item === 'object' &&
						typeof item.path === 'string' &&
						typeof item.content === 'string'
					) {
						const originalContent = readOriginalFile(item.path) ?? '';
						entries.push({
							filePath: item.path,
							oldContent: originalContent,
							newContent: item.content,
						});
					}
				}
			}
		}
	} catch {
		// Ignore parse errors
	}
	return entries;
}

/**
 * Enrich tool arguments with diff preview data for the pending DiffViewer
 * display. Supports filesystem-edit, filesystem-replaceedit, and
 * filesystem-create — both single-file and batch (array filePath) modes.
 *
 * For single-file calls, adds oldContent/newContent (edit/replaceedit) or
 * content/path (create) directly. For batch calls, adds isBatch + batchResults
 * array so MessageRenderer can render per-file DiffViewers during pending.
 *
 * Returns the enriched arguments object, or the original arguments if diff
 * preview could not be computed.
 */
export function enrichPendingEditArgs(
	toolName: string,
	toolArgs: Record<string, any>,
): Record<string, any> {
	if (
		toolName !== 'filesystem-edit' &&
		toolName !== 'filesystem-replaceedit' &&
		toolName !== 'filesystem-create' &&
		toolName !== 'filesystem-copy'
	) {
		return toolArgs;
	}

	// Normalize filePath: some AI models return filePath as a JSON string
	// instead of a real array. Parse it so isBatch detection works correctly.
	const rawFilePath = toolArgs['filePath'];
	if (
		typeof rawFilePath === 'string' &&
		rawFilePath.trimStart().startsWith('[')
	) {
		try {
			toolArgs = {...toolArgs, filePath: JSON.parse(rawFilePath)};
		} catch {
			// Not valid JSON — leave as-is (single file path string)
		}
	}

	const isBatch = toolArgs['isBatch'] || Array.isArray(toolArgs['filePath']);

	// filesystem-copy: a call may touch 1 file (copy) or 2 files (cut across
	// files). Present multiple touched files as batchResults so each file
	// gets its own DiffViewer during pending.
	if (toolName === 'filesystem-copy') {
		const copyEntries = collectDiffPreviewEntries(
			toolName,
			JSON.stringify(toolArgs),
		);
		if (copyEntries.length === 0) {
			return toolArgs;
		}
		if (copyEntries.length === 1) {
			const entry = copyEntries[0]!;
			return {
				...toolArgs,
				oldContent: entry.oldContent,
				newContent: entry.newContent,
				filename: entry.filePath,
			};
		}
		return {
			...toolArgs,
			isBatch: true,
			batchResults: copyEntries.map(entry => ({
				success: true,
				path: entry.filePath,
				oldContent: entry.oldContent,
				newContent: entry.newContent,
			})),
		};
	}

	// Single-file (non-batch) calls: compute oldContent/newContent directly.
	if (!isBatch) {
		const entries = collectDiffPreviewEntries(
			toolName,
			JSON.stringify(toolArgs),
		);
		if (entries.length === 1) {
			const entry = entries[0]!;
			if (toolName === 'filesystem-create') {
				return {
					...toolArgs,
					content: entry.newContent,
					path: entry.filePath,
				};
			}
			return {
				...toolArgs,
				oldContent: entry.oldContent,
				newContent: entry.newContent,
				filename: entry.filePath,
			};
		}
		return toolArgs;
	}

	// Batch calls: compute batchResults so DiffViewer can render during pending.
	const entries = collectDiffPreviewEntries(toolName, JSON.stringify(toolArgs));
	if (entries.length === 0) {
		return toolArgs;
	}

	if (toolName === 'filesystem-create') {
		const batchResults = entries.map(entry => ({
			success: true,
			path: entry.filePath,
			content: entry.newContent,
		}));
		return {
			...toolArgs,
			isBatch: true,
			batchResults,
		};
	}

	// filesystem-edit / filesystem-replaceedit batch
	const batchResults = entries.map(entry => ({
		success: true,
		path: entry.filePath,
		oldContent: entry.oldContent,
		newContent: entry.newContent,
	}));
	return {
		...toolArgs,
		isBatch: true,
		batchResults,
	};
}
