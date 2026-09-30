import * as path from 'path';
import * as prettier from 'prettier';
import {isAbsolute} from 'path';
import type {Diagnostic} from '../../../utils/ui/vscodeConnection.js';
import type {
	CopySegmentChangedFile,
	CopySegmentResult,
	EditByHashlineSingleResult,
	EditBySearchSingleResult,
	HashlineOperation,
} from '../../types/filesystem.types.js';
import {
	tryUnescapeFix,
	trimPairIfPossible,
	isOverEscaped,
} from '../../../utils/ui/escapeHandler.js';
import {
	calculateSimilarity,
	calculateNormalizedSimilarityAsync,
	findBestInlineSubstring,
	normalizeForDisplay,
	normalizeWhitespace,
} from '../../utils/filesystem/similarity.utils.js';
import {
	analyzeCodeStructure,
	findSmartContextBoundaries,
} from '../../utils/filesystem/code-analysis.utils.js';
import {
	findClosestMatches,
	generateDiffMessage,
} from '../../utils/filesystem/match-finder.utils.js';
import {
	applyTextEditsWithNative,
	scanFuzzyMatchesWithNative,
	readFileWithNative,
	writeFileWithNative,
	type NativeTextEdit,
} from '../../utils/filesystem/native-edit.utils.js';
import {
	readFileWithEncoding,
	writeFileWithEncoding,
} from '../../utils/filesystem/encoding.utils.js';
import {getAutoFormatEnabled} from '../../../utils/config/projectSettings.js';
import {
	formatLineWithHashDisplay,
	validateAnchor,
} from '../../utils/filesystem/hashline.utils.js';
import {getFreshDiagnostics} from '../../utils/filesystem/diagnostics.utils.js';
import {
	appendDiagnosticsSummary,
	appendStructureWarnings,
} from '../../utils/filesystem/message-format.utils.js';
import {backupFileBeforeMutation} from '../../utils/filesystem/backup.utils.js';

/**
 * Read a file using Rust native I/O (encoding-aware, runs on libuv thread),
 * falling back to the Node.js implementation if the native accelerator is
 * unavailable or fails.
 */
async function readFileSmart(fullPath: string): Promise<string> {
	const native = await readFileWithNative(fullPath);
	if (native !== undefined) {
		return native;
	}
	return readFileWithEncoding(fullPath);
}

/**
 * Write a file using Rust native I/O (preserves original encoding, runs on
 * libuv thread), falling back to the Node.js implementation if the native
 * accelerator is unavailable or fails.
 */
async function writeFileSmart(
	fullPath: string,
	content: string,
): Promise<void> {
	const ok = await writeFileWithNative(fullPath, content);
	if (ok) {
		return;
	}
	await writeFileWithEncoding(fullPath, content);
}

type EditToolContext = {
	basePath: string;
	prettierSupportedExtensions: string[];
	isSSHPath: (filePath: string) => boolean;
	readRemoteFile: (sshUrl: string) => Promise<string>;
	writeRemoteFile: (sshUrl: string, content: string) => Promise<void>;
	resolvePath: (filePath: string, contextPath?: string) => string;
	validatePath: (fullPath: string) => Promise<void>;
};

/**
 * Sliding-window fuzzy matcher with variable window size for large code blocks.
 * When the search block is large (>= 10 lines), the window is allowed to
 * expand/contract by a few lines to better align with the actual code block
 * boundaries, preventing duplicate boundary lines after replacement.
 */
async function fuzzyMatchSlidingWindow(
	contentLines: string[],
	searchLines: string[],
	normalizedSearchForSimilarity: string,
	searchRaw: string,
	threshold: number,
	maxMatches: number,
	usePreFilter: boolean,
	preFilterThreshold: number,
	searchFirstLine: string,
): Promise<
	Array<{
		startLine: number;
		endLine: number;
		similarity: number;
		startColumn?: number;
		endColumn?: number;
	}>
> {
	const result: Array<{
		startLine: number;
		endLine: number;
		similarity: number;
		startColumn?: number;
		endColumn?: number;
	}> = [];
	const windowDelta =
		searchLines.length >= 10
			? Math.min(15, Math.max(3, Math.floor(searchLines.length / 5)))
			: 0;
	const isSingleLine = searchLines.length === 1;

	for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
		if (i > 0 && i % 100 === 0) {
			await new Promise<void>(resolve => setImmediate(resolve));
		}

		if (usePreFilter) {
			const firstLineSimilarity = calculateSimilarity(
				searchFirstLine,
				normalizeWhitespace(contentLines[i] || ''),
				preFilterThreshold,
			);
			if (firstLineSimilarity < preFilterThreshold) {
				continue;
			}
		}

		const candidateLines = contentLines.slice(i, i + searchLines.length);
		const candidateContent = candidateLines.join('\n');
		const exactSimilarity =
			candidateContent === searchRaw
				? 1
				: await calculateNormalizedSimilarityAsync(
						normalizedSearchForSimilarity,
						normalizeWhitespace(candidateContent),
						threshold,
				  );

		// Single-line search: also try inline (within-line substring) matching.
		// Handles the common case where the AI only provides part of a line
		// (e.g. a Chinese comment fragment) instead of the whole line — the
		// whole-line similarity would otherwise fail the length-ratio check.
		const inlineMatch = isSingleLine
			? await findBestInlineSubstring(
					contentLines[i] ?? '',
					searchRaw,
					normalizedSearchForSimilarity,
					threshold,
			  )
			: null;

		// Exact inline hit (1.0): prefer it over any whole-line fuzzy score so
		// we never replace the whole line with a partial substring.
		if (inlineMatch && inlineMatch.similarity >= 1) {
			result.push({
				startLine: i + 1,
				endLine: i + 1,
				similarity: 1,
				startColumn: inlineMatch.start,
				endColumn: inlineMatch.end,
			});
			break;
		}

		// High-confidence match: accept immediately without trying other sizes
		if (exactSimilarity >= 0.9) {
			result.push({
				startLine: i + 1,
				endLine: i + searchLines.length,
				similarity: exactSimilarity,
			});
			if (exactSimilarity >= 0.95 || result.length >= maxMatches) {
				break;
			}
			continue;
		}

		// Single line: pick the better of inline vs whole-line fuzzy score.
		if (isSingleLine) {
			const inlineScore = inlineMatch?.similarity ?? 0;
			if (inlineScore >= threshold && inlineScore >= exactSimilarity) {
				result.push({
					startLine: i + 1,
					endLine: i + 1,
					similarity: inlineScore,
					startColumn: inlineMatch?.start,
					endColumn: inlineMatch?.end,
				});
				if (inlineScore >= 0.95 || result.length >= maxMatches) {
					break;
				}
				continue;
			}
		}

		// Variable window for large blocks: try nearby window sizes for better
		// boundary alignment
		if (windowDelta > 0) {
			let bestSimilarity = exactSimilarity;
			let bestEndLine = i + searchLines.length;

			for (let delta = 1; delta <= windowDelta; delta++) {
				// Smaller window
				const smallerLen = searchLines.length - delta;
				if (smallerLen > 0 && i + smallerLen <= contentLines.length) {
					const smallerCandidate = contentLines
						.slice(i, i + smallerLen)
						.join('\n');
					const smallerSim =
						smallerCandidate === searchRaw
							? 1
							: await calculateNormalizedSimilarityAsync(
									normalizedSearchForSimilarity,
									normalizeWhitespace(smallerCandidate),
									threshold,
							  );
					if (smallerSim > bestSimilarity) {
						bestSimilarity = smallerSim;
						bestEndLine = i + smallerLen;
					}
				}

				// Larger window
				const largerLen = searchLines.length + delta;
				if (i + largerLen <= contentLines.length) {
					const largerCandidate = contentLines
						.slice(i, i + largerLen)
						.join('\n');
					const largerSim =
						largerCandidate === searchRaw
							? 1
							: await calculateNormalizedSimilarityAsync(
									normalizedSearchForSimilarity,
									normalizeWhitespace(largerCandidate),
									threshold,
							  );
					if (largerSim > bestSimilarity) {
						bestSimilarity = largerSim;
						bestEndLine = i + largerLen;
					}
				}

				if (bestSimilarity >= 0.95) break;
			}

			if (bestSimilarity >= threshold) {
				result.push({
					startLine: i + 1,
					endLine: bestEndLine,
					similarity: bestSimilarity,
				});
				if (bestSimilarity >= 0.95 || result.length >= maxMatches) {
					break;
				}
			}
		} else if (exactSimilarity >= threshold) {
			result.push({
				startLine: i + 1,
				endLine: i + searchLines.length,
				similarity: exactSimilarity,
			});
			if (exactSimilarity >= 0.95 || result.length >= maxMatches) {
				break;
			}
		}
	}

	return result;
}

export async function executeEditBySearchSingle(
	ctx: EditToolContext,
	filePath: string,
	searchContent: string,
	replaceContent: string,
	occurrence: number,
	contextLines: number,
): Promise<EditBySearchSingleResult> {
	try {
		const isRemote = ctx.isSSHPath(filePath);
		let content: string;
		let fullPath: string;

		if (isRemote) {
			content = await ctx.readRemoteFile(filePath);
			fullPath = filePath;
		} else {
			fullPath = ctx.resolvePath(filePath);
			if (!isAbsolute(filePath)) {
				await ctx.validatePath(fullPath);
			}
			content = await readFileSmart(fullPath);
		}

		const lines = content.split('\n');
		await backupFileBeforeMutation({
			filePath,
			basePath: ctx.basePath,
			fileExisted: true,
			originalContent: content,
		});

		let normalizedSearch = searchContent
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n');
		const normalizedContent = content
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n');
		let searchLines = normalizedSearch.split('\n');
		const contentLines = normalizedContent.split('\n');
		const matches: Array<{
			startLine: number;
			endLine: number;
			similarity: number;
			startColumn?: number;
			endColumn?: number;
		}> = [];
		const threshold = 0.85;
		const searchFirstLine = searchLines[0]?.replace(/\s+/g, ' ').trim() || '';
		const usePreFilter = searchLines.length >= 5;
		const preFilterThreshold = 0.2;
		const maxMatches = 10;
		const nativeMatches = await scanFuzzyMatchesWithNative(
			normalizedContent,
			normalizedSearch,
			threshold,
			maxMatches,
			usePreFilter,
			preFilterThreshold,
		);

		if (nativeMatches) {
			for (const match of nativeMatches) {
				matches.push({
					startLine: match.startLine,
					endLine: match.endLine,
					similarity: match.similarity,
					startColumn: match.startColumn ?? undefined,
					endColumn: match.endColumn ?? undefined,
				});
			}
		} else {
			const normalizedSearchForSimilarity =
				normalizeWhitespace(normalizedSearch);
			const fallbackMatches = await fuzzyMatchSlidingWindow(
				contentLines,
				searchLines,
				normalizedSearchForSimilarity,
				normalizedSearch,
				threshold,
				maxMatches,
				usePreFilter,
				preFilterThreshold,
				searchFirstLine,
			);
			matches.push(...fallbackMatches);
		}

		matches.sort((a, b) => b.similarity - a.similarity);

		if (matches.length === 0) {
			const unescapeFix = tryUnescapeFix(
				normalizedContent,
				normalizedSearch,
				1,
			);
			if (unescapeFix) {
				const correctedSearchLines = unescapeFix.correctedString.split('\n');
				const correctedNativeMatches = await scanFuzzyMatchesWithNative(
					normalizedContent,
					unescapeFix.correctedString,
					threshold,
					maxMatches,
					correctedSearchLines.length >= 5,
					preFilterThreshold,
				);
				if (correctedNativeMatches) {
					for (const match of correctedNativeMatches) {
						matches.push({
							startLine: match.startLine,
							endLine: match.endLine,
							similarity: match.similarity,
							startColumn: match.startColumn ?? undefined,
							endColumn: match.endColumn ?? undefined,
						});
					}
				} else {
					const normalizedCorrectedSearch = normalizeWhitespace(
						unescapeFix.correctedString,
					);
					const correctedFirstLine =
						correctedSearchLines[0]?.replace(/\s+/g, ' ').trim() || '';
					const correctedMatches = await fuzzyMatchSlidingWindow(
						contentLines,
						correctedSearchLines,
						normalizedCorrectedSearch,
						unescapeFix.correctedString,
						threshold,
						maxMatches,
						correctedSearchLines.length >= 5,
						preFilterThreshold,
						correctedFirstLine,
					);
					matches.push(...correctedMatches);
				}
				matches.sort((a, b) => b.similarity - a.similarity);
				if (matches.length > 0) {
					const trimResult = trimPairIfPossible(
						unescapeFix.correctedString,
						replaceContent,
						normalizedContent,
						1,
					);
					normalizedSearch = trimResult.target;
					replaceContent = trimResult.paired;
					searchLines = normalizedSearch.split('\n');
				}
			}

			if (matches.length === 0) {
				const closestMatches = await findClosestMatches(
					normalizedSearch,
					normalizedContent.split('\n'),
					3,
				);
				let errorMessage = `❌ Search content not found in file: ${filePath}\n\n`;
				errorMessage += `🔍 Using smart fuzzy matching (threshold: ${threshold})\n`;
				if (isOverEscaped(searchContent)) {
					errorMessage += `⚠️  Detected over-escaped content, automatic fix attempted but failed\n`;
				}
				errorMessage += `\n`;
				if (closestMatches.length > 0) {
					errorMessage += `💡 Found ${closestMatches.length} similar location(s):\n\n`;
					closestMatches.forEach((candidate, idx) => {
						const location =
							candidate.startColumn !== undefined &&
							candidate.endColumn !== undefined
								? `Line ${candidate.startLine} (inline columns ${candidate.startColumn}-${candidate.endColumn})`
								: `Lines ${candidate.startLine}-${candidate.endLine}`;
						errorMessage += `${idx + 1}. ${location} (${(
							candidate.similarity * 100
						).toFixed(0)}% match):\n`;
						errorMessage += `${candidate.preview}\n\n`;
					});

					const bestMatch = closestMatches[0];
					if (bestMatch) {
						const bestMatchContent = lines
							.slice(bestMatch.startLine - 1, bestMatch.endLine)
							.join('\n');
						const diffMsg = generateDiffMessage(
							normalizedSearch,
							bestMatchContent,
							5,
						);
						if (diffMsg) {
							errorMessage += `📊 Difference with closest match:\n${diffMsg}\n\n`;
						}
					}
					errorMessage += `💡 Suggestions:\n`;
					errorMessage += `  • Make sure you copied raw code from the file (strip any "lineNum:hash→" prefixes from filesystem-read if you pasted read output)\n`;
					errorMessage += `  • Whitespace differences are automatically handled\n`;
					errorMessage += `  • Try copying a larger or smaller code block\n`;
					errorMessage += `  • If multiple filesystem-replaceedit attempts fail, use terminal-execute to edit via command line (e.g. sed, printf)\n`;
					errorMessage += `⚠️  No similar content found in the file.\n\n`;
					errorMessage += `📝 What you searched for (first 5 lines, formatted):\n`;
					searchLines.slice(0, 5).forEach((line, idx) => {
						errorMessage += `${idx + 1}. ${JSON.stringify(
							normalizeForDisplay(line),
						)}\n`;
					});
					errorMessage += `\n💡 Copy exact source text (not hashline-prefixed read lines)\n`;
				}
				throw new Error(errorMessage);
			}
		}

		let selectedMatch: {
			startLine: number;
			endLine: number;
			startColumn?: number;
			endColumn?: number;
		};
		if (occurrence === -1) {
			if (matches.length === 1) {
				selectedMatch = matches[0]!;
			} else {
				throw new Error(
					`Found ${matches.length} matches. Please specify which occurrence to replace (1-${matches.length}), or use occurrence=-1 to replace all (not yet implemented for safety).`,
				);
			}
		} else if (occurrence < 1 || occurrence > matches.length) {
			throw new Error(
				`Invalid occurrence ${occurrence}. Found ${
					matches.length
				} match(es) at lines: ${matches.map(m => m.startLine).join(', ')}`,
			);
		} else {
			selectedMatch = matches[occurrence - 1]!;
		}

		const {startLine, endLine, startColumn, endColumn} = selectedMatch;
		const normalizedReplace = replaceContent
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n');
		const beforeLines = lines.slice(0, startLine - 1);
		const afterLines = lines.slice(endLine);
		let replaceLines = normalizedReplace.split('\n');

		// Inline substring edit: only replace the [startColumn, endColumn) span
		// of the single matched line, preserving the rest of the line. This is
		// the core fix for editing part of a line (e.g. a Chinese comment
		// fragment) without destroying the surrounding content.
		const isInlineEdit =
			startColumn !== undefined &&
			endColumn !== undefined &&
			startLine === endLine &&
			replaceLines.length === 1;

		let modifiedLines: string[];
		let replacedContent: string;
		if (isInlineEdit) {
			const targetLine = lines[startLine - 1] ?? '';
			replacedContent = targetLine.slice(startColumn, endColumn);
			const newLine =
				targetLine.slice(0, startColumn) +
				replaceLines[0]! +
				targetLine.slice(endColumn);
			modifiedLines = [...beforeLines, newLine, ...afterLines];
		} else {
			if (replaceLines.length > 0) {
				const originalFirstLine = lines[startLine - 1];
				const originalIndent = originalFirstLine?.match(/^(\s*)/)?.[1] || '';
				const replaceFirstLine = replaceLines[0];
				const replaceIndent = replaceFirstLine?.match(/^(\s*)/)?.[1] || '';
				if (originalIndent !== replaceIndent && replaceFirstLine) {
					replaceLines[0] = originalIndent + replaceFirstLine.trim();
				}
			}

			replacedContent = lines.slice(startLine - 1, endLine).join('\n');
			modifiedLines = [...beforeLines, ...replaceLines, ...afterLines];
		}

		const modifiedContent = modifiedLines.join('\n');
		const lineDifference = replaceLines.length - (endLine - startLine + 1);
		const smartBoundaries = findSmartContextBoundaries(
			lines,
			startLine,
			endLine,
			contextLines,
		);
		const contextStart = smartBoundaries.start;
		const contextEnd = smartBoundaries.end;
		const oldContent = lines.slice(contextStart - 1, contextEnd).join('\n');

		if (isRemote) {
			await ctx.writeRemoteFile(fullPath, modifiedContent);
		} else {
			await writeFileSmart(fullPath, modifiedContent);
		}

		const diffContextEnd = Math.min(
			modifiedLines.length,
			contextEnd + lineDifference,
		);
		let finalContent = modifiedContent;
		let finalLines = modifiedLines;
		let finalTotalLines = modifiedLines.length;
		const fileExtension = path.extname(fullPath).toLowerCase();
		const shouldFormat =
			getAutoFormatEnabled() &&
			ctx.prettierSupportedExtensions.includes(fileExtension);

		if (shouldFormat) {
			try {
				const prettierConfig = await prettier.resolveConfig(fullPath);
				finalContent = await prettier.format(modifiedContent, {
					filepath: fullPath,
					...prettierConfig,
				});
				if (isRemote) {
					await ctx.writeRemoteFile(fullPath, finalContent);
				} else {
					await writeFileSmart(fullPath, finalContent);
				}
				finalLines = finalContent.split('\n');
				finalTotalLines = finalLines.length;
			} catch {
				// non-fatal
			}
		}

		const newContextContent = modifiedLines
			.slice(contextStart - 1, diffContextEnd)
			.join('\n');
		const overflowPadding = Math.max(3, contextLines);
		const completeOldStart = Math.max(1, contextStart - overflowPadding);
		const completeOldEnd = Math.min(lines.length, contextEnd + overflowPadding);
		const completeOldContent = lines
			.slice(completeOldStart - 1, completeOldEnd)
			.join('\n');
		const editLineDelta = modifiedLines.length - lines.length;
		const completeNewStart = Math.max(1, completeOldStart);
		const completeNewEnd = Math.min(
			modifiedLines.length,
			completeOldEnd + editLineDelta,
		);
		const completeNewContent = modifiedLines
			.slice(completeNewStart - 1, completeNewEnd)
			.join('\n');

		const structureAnalysis = analyzeCodeStructure(
			finalContent,
			filePath,
			replaceLines,
		);
		let diagnostics: Diagnostic[] = [];
		try {
			diagnostics = await getFreshDiagnostics(fullPath);
		} catch {
			// optional
		}

		const result = {
			message:
				`✅ File edited successfully using search-replace (safer boundary detection): ${filePath}\n` +
				`   Matched: lines ${startLine}-${endLine} (occurrence ${occurrence}/${matches.length})` +
				(isInlineEdit ? `, inline columns ${startColumn}-${endColumn}` : '') +
				`\n   Result: ${replaceLines.length} new lines` +
				(smartBoundaries.extended
					? `\n   📍 Context auto-extended to show complete code block (lines ${contextStart}-${diffContextEnd})`
					: ''),
			filePath,
			oldContent,
			newContent: newContextContent,
			completeOldContent,
			completeNewContent,
			replacedContent,
			matchLocation: {startLine, endLine},
			contextStartLine: contextStart,
			contextEndLine: diffContextEnd,
			totalLines: finalTotalLines,
			structureAnalysis,
			diagnostics: undefined as Diagnostic[] | undefined,
		};

		if (diagnostics.length > 0) {
			result.diagnostics = diagnostics.slice(0, 10);
			result.message = appendDiagnosticsSummary(
				result.message,
				filePath,
				diagnostics,
				{
					includeTip: true,
				},
			);
		}

		result.message = appendStructureWarnings(
			result.message,
			structureAnalysis,
			'💡 TIP: These warnings help identify potential issues. If intentional (e.g., opening a block), you can ignore them.',
		);

		return result;
	} catch (error) {
		throw new Error(
			`Failed to edit file ${filePath}: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
}

export async function executeHashlineEditSingle(
	ctx: EditToolContext,
	filePath: string,
	operations: HashlineOperation[],
	contextLines: number,
): Promise<EditByHashlineSingleResult> {
	try {
		const isRemote = ctx.isSSHPath(filePath);
		let content: string;
		let fullPath: string;

		if (isRemote) {
			content = await ctx.readRemoteFile(filePath);
			fullPath = filePath;
		} else {
			fullPath = ctx.resolvePath(filePath);
			if (!isAbsolute(filePath)) {
				await ctx.validatePath(fullPath);
			}
			content = await readFileSmart(fullPath);
		}

		const lines = content.split('\n');
		await backupFileBeforeMutation({
			filePath,
			basePath: ctx.basePath,
			fileExisted: true,
			originalContent: content,
		});

		type PreparedHashlineOperation = {
			op: HashlineOperation;
			originalIndex: number;
			startLine: number;
			endLine: number;
		};

		const preparedOps: PreparedHashlineOperation[] = [];
		const anchorErrors: string[] = [];
		for (const [originalIndex, op] of operations.entries()) {
			const startV = validateAnchor(op.startAnchor, lines);
			if (!startV.valid) {
				anchorErrors.push(
					`Anchor "${op.startAnchor}" invalid` +
						(startV.expected && startV.actual
							? ` (expected hash ${startV.expected}, actual ${startV.actual})`
							: startV.lineNum > 0
							? ` (line ${startV.lineNum} out of range or hash mismatch)`
							: ' (bad format, expected "lineNum:hash")'),
				);
			}

			let endLine = startV.lineNum;
			let hasValidRange = startV.valid;
			const endAnchorMissing =
				op.endAnchor === undefined ||
				op.endAnchor === null ||
				(typeof op.endAnchor === 'string' && op.endAnchor.trim() === '');
			if (endAnchorMissing) {
				anchorErrors.push(
					`Operation ${originalIndex + 1} (${
						op.type
					}): endAnchor is required. For a single-line replace or delete, set endAnchor to the same "lineNum:hash" as startAnchor. For insert_after, repeat startAnchor as endAnchor.`,
				);
				hasValidRange = false;
			} else {
				const endV = validateAnchor(op.endAnchor, lines);
				if (!endV.valid) {
					anchorErrors.push(
						`Anchor "${op.endAnchor}" invalid` +
							(endV.expected && endV.actual
								? ` (expected hash ${endV.expected}, actual ${endV.actual})`
								: endV.lineNum > 0
								? ` (line ${endV.lineNum} out of range or hash mismatch)`
								: ' (bad format, expected "lineNum:hash")'),
					);
					hasValidRange = false;
				} else {
					endLine = endV.lineNum;
					if (startV.valid && endLine < startV.lineNum) {
						anchorErrors.push(
							`endAnchor line ${endLine} is before startAnchor line ${startV.lineNum}`,
						);
						hasValidRange = false;
					}
				}
			}

			if (
				(op.type === 'replace' || op.type === 'insert_after') &&
				op.content === undefined
			) {
				anchorErrors.push(`Operation "${op.type}" requires content`);
			}

			if (hasValidRange) {
				preparedOps.push({
					op,
					originalIndex,
					startLine: startV.lineNum,
					endLine,
				});
			}
		}

		if (anchorErrors.length > 0) {
			throw new Error(
				`❌ Hashline anchor validation failed for ${filePath}:\n` +
					anchorErrors.map(e => `  • ${e}`).join('\n') +
					`\n\n💡 The file may have changed since your last read. Re-read the file to get fresh anchors.`,
			);
		}

		const conflictErrors: string[] = [];
		for (let i = 0; i < preparedOps.length; i++) {
			const current = preparedOps[i]!;
			for (let j = i + 1; j < preparedOps.length; j++) {
				const next = preparedOps[j]!;
				const sameStartLine = current.startLine === next.startLine;
				const bothInsertAfter =
					current.op.type === 'insert_after' &&
					next.op.type === 'insert_after' &&
					sameStartLine;
				if (bothInsertAfter) continue;

				const sameSingleLineAnchor =
					sameStartLine &&
					current.startLine === current.endLine &&
					next.startLine === next.endLine;
				const hasInsertAfter =
					current.op.type === 'insert_after' || next.op.type === 'insert_after';
				if (sameSingleLineAnchor && hasInsertAfter) continue;

				const overlaps =
					current.startLine <= next.endLine &&
					next.startLine <= current.endLine;
				if (!overlaps) continue;

				conflictErrors.push(
					`Operation ${current.originalIndex + 1} (${current.op.type} ${
						current.startLine
					}-${current.endLine}) conflicts with operation ${
						next.originalIndex + 1
					} (${next.op.type} ${next.startLine}-${next.endLine})`,
				);
			}
		}

		if (conflictErrors.length > 0) {
			throw new Error(
				`Hashline operations conflict for ${filePath}:\n` +
					conflictErrors.map(e => `  • ${e}`).join('\n') +
					`\n\nUse non-overlapping anchors for the same file, or split dependent edits into separate calls.`,
			);
		}

		const sortedOps = [...preparedOps].sort((a, b) => {
			if (a.startLine !== b.startLine) return b.startLine - a.startLine;
			const aInsertAfter = a.op.type === 'insert_after';
			const bInsertAfter = b.op.type === 'insert_after';
			if (aInsertAfter && bInsertAfter)
				return b.originalIndex - a.originalIndex;
			if (aInsertAfter !== bInsertAfter) return aInsertAfter ? -1 : 1;
			if (a.endLine !== b.endLine) return b.endLine - a.endLine;
			return b.originalIndex - a.originalIndex;
		});

		let editStartLine = Infinity;
		let editEndLine = 0;
		let mutableLines = [...lines];
		const nativeEdits: NativeTextEdit[] = [];
		const opSummaries: string[] = [];
		const hashlineContentRe = /^\s*\d+:[0-9a-fA-F]{2}→/;
		const sanitizeContent = (raw: string): string => {
			const contentLines = raw.split('\n');
			const hasHashlines =
				contentLines.length > 0 &&
				contentLines.every(line => line === '' || hashlineContentRe.test(line));
			if (!hasHashlines) return raw;
			return contentLines
				.map(line => {
					let value = line;
					let match: RegExpExecArray | null;
					while ((match = hashlineContentRe.exec(value))) {
						value = value.slice(match[0].length);
					}
					return value;
				})
				.join('\n');
		};

		for (const preparedOp of sortedOps) {
			const {op, startLine, endLine} = preparedOp;
			editStartLine = Math.min(editStartLine, startLine);
			editEndLine = Math.max(editEndLine, endLine);
			switch (op.type) {
				case 'replace': {
					const replacement = sanitizeContent(op.content ?? '');
					const newLines = replacement.split('\n');
					nativeEdits.push({
						kind: 'replace',
						startLine,
						endLine,
						content: replacement,
					});
					opSummaries.push(
						`replace lines ${startLine}-${endLine} → ${newLines.length} line(s)`,
					);
					break;
				}
				case 'insert_after': {
					const insertion = sanitizeContent(op.content ?? '');
					const newLines = insertion.split('\n');
					nativeEdits.push({
						kind: 'insert_after',
						startLine,
						endLine,
						content: insertion,
					});
					opSummaries.push(
						`insert ${newLines.length} line(s) after line ${startLine}`,
					);
					break;
				}
				case 'delete': {
					nativeEdits.push({kind: 'delete', startLine, endLine});
					opSummaries.push(`delete lines ${startLine}-${endLine}`);
					break;
				}
			}
		}

		const nativeContent = await applyTextEditsWithNative(content, nativeEdits);
		if (nativeContent !== undefined) {
			mutableLines = nativeContent.split('\n');
		} else {
			for (const edit of nativeEdits) {
				const newLines = (edit.content ?? '').split('\n');
				switch (edit.kind) {
					case 'replace': {
						mutableLines.splice(
							edit.startLine - 1,
							edit.endLine - edit.startLine + 1,
							...newLines,
						);
						break;
					}
					case 'insert_after': {
						mutableLines.splice(edit.startLine, 0, ...newLines);
						break;
					}
					case 'delete': {
						mutableLines.splice(
							edit.startLine - 1,
							edit.endLine - edit.startLine + 1,
						);
						break;
					}
				}
			}
		}

		const replacedContent = lines
			.slice(editStartLine - 1, editEndLine)
			.map((line, idx) => {
				const ln = editStartLine + idx;
				return formatLineWithHashDisplay(ln, line, normalizeForDisplay(line));
			})
			.join('\n');

		const smartBoundaries = findSmartContextBoundaries(
			lines,
			editStartLine,
			editEndLine,
			contextLines,
		);
		const contextStart = smartBoundaries.start;
		const contextEnd = smartBoundaries.end;
		const oldContent = lines
			.slice(contextStart - 1, contextEnd)
			.map((line, idx) => {
				const ln = contextStart + idx;
				return formatLineWithHashDisplay(ln, line, normalizeForDisplay(line));
			})
			.join('\n');

		const modifiedContent = mutableLines.join('\n');
		if (isRemote) {
			await ctx.writeRemoteFile(fullPath, modifiedContent);
		} else {
			await writeFileSmart(fullPath, modifiedContent);
		}

		let finalLines = mutableLines;
		let finalTotalLines = mutableLines.length;
		const lineDifference = mutableLines.length - lines.length;
		let finalContextEnd = Math.min(
			finalTotalLines,
			contextEnd + lineDifference,
		);
		const fileExtension = path.extname(fullPath).toLowerCase();
		const shouldFormat =
			getAutoFormatEnabled() &&
			ctx.prettierSupportedExtensions.includes(fileExtension);

		if (shouldFormat) {
			try {
				const prettierConfig = await prettier.resolveConfig(fullPath);
				const formatted = await prettier.format(modifiedContent, {
					filepath: fullPath,
					...prettierConfig,
				});
				if (isRemote) {
					await ctx.writeRemoteFile(fullPath, formatted);
				} else {
					await writeFileSmart(fullPath, formatted);
				}
				finalLines = formatted.split('\n');
				finalTotalLines = finalLines.length;
				finalContextEnd = Math.min(
					finalTotalLines,
					contextStart + (contextEnd - contextStart) + lineDifference,
				);
			} catch {
				// non-fatal
			}
		}

		const newContextContent = finalLines
			.slice(contextStart - 1, finalContextEnd)
			.map((line, idx) => {
				const ln = contextStart + idx;
				return formatLineWithHashDisplay(ln, line, normalizeForDisplay(line));
			})
			.join('\n');

		const structureAnalysis = analyzeCodeStructure(
			finalLines.join('\n'),
			filePath,
			finalLines.slice(
				editStartLine - 1,
				editStartLine - 1 + (editEndLine - editStartLine + 1),
			),
		);

		let diagnostics: Diagnostic[] = [];
		try {
			diagnostics = await getFreshDiagnostics(fullPath);
		} catch {
			// optional
		}

		const result: EditByHashlineSingleResult = {
			message:
				`✅ File edited via hashline anchors: ${filePath}\n` +
				`   Operations: ${opSummaries.join('; ')}\n` +
				`   Result: ${finalTotalLines} total lines` +
				(smartBoundaries.extended
					? `\n   📍 Context auto-extended (lines ${contextStart}-${finalContextEnd})`
					: ''),
			filePath,
			oldContent,
			newContent: newContextContent,
			replacedContent,
			operationsSummary: opSummaries.join('; '),
			contextStartLine: contextStart,
			contextEndLine: finalContextEnd,
			totalLines: finalTotalLines,
			structureAnalysis,
			diagnostics: undefined,
		};

		if (diagnostics.length > 0) {
			result.diagnostics = diagnostics.slice(0, 10);
			result.message = appendDiagnosticsSummary(
				result.message,
				filePath,
				diagnostics,
				{
					headerLabel: 'Diagnostics',
					detailsLabel: 'Details',
					moreSuffix: 'more',
				},
			);
		}

		result.message = appendStructureWarnings(result.message, structureAnalysis);
		return result;
	} catch (error) {
		throw new Error(
			`Failed to edit file ${filePath}: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
}

/**
 * Resolve a target line (1-indexed) into a 0-based insertion index.
 * When targetLine is omitted, the segment is appended at the end.
 */
function resolveInsertIndex(
	targetLine: number | undefined,
	position: 'before' | 'after',
	lineCount: number,
): number {
	if (targetLine === undefined || targetLine === null) {
		return lineCount;
	}
	if (!Number.isInteger(targetLine) || targetLine < 1) {
		throw new Error('targetLine must be a positive integer (1-indexed).');
	}
	const index = position === 'after' ? targetLine : targetLine - 1;
	return Math.max(0, Math.min(lineCount, index));
}

/** Slice a padded context snippet (1-indexed, inclusive) for diff display. */
function sliceContextSnippet(
	lines: string[],
	from: number,
	to: number,
	padding: number,
): string {
	const start = Math.max(1, from - padding);
	const end = Math.min(lines.length, to + padding);
	if (end < start) {
		return '';
	}
	return lines.slice(start - 1, end).join('\n');
}

/** Insert lines into an array without mutating the source array. */
function insertLines(
	base: string[],
	index: number,
	inserted: string[],
): string[] {
	return [...base.slice(0, index), ...inserted, ...base.slice(index)];
}

/**
 * Copy or cut a code segment identified by a line range and paste it at a
 * target location (same file or another file).
 *
 * - `copy` duplicates the segment, leaving the source untouched.
 * - `cut` moves the segment (removes it from the source).
 *
 * The segment content is never re-emitted by the caller, which saves tokens
 * compared to reading the file and re-writing the block by hand. Supports
 * local and SSH (`ssh://`) paths; on SSH, the source/target file must already
 * be reachable via SFTP.
 */
export async function executeCopySegmentSingle(
	ctx: EditToolContext,
	filePath: string,
	startLine: number,
	endLine: number,
	targetPath: string | undefined,
	targetLine: number | undefined,
	position: 'before' | 'after',
	mode: 'copy' | 'cut',
	contextLines: number,
): Promise<CopySegmentResult> {
	try {
		if (mode !== 'copy' && mode !== 'cut') {
			throw new Error('Invalid mode. Expected "copy" or "cut".');
		}
		if (position !== 'before' && position !== 'after') {
			throw new Error('Invalid position. Expected "before" or "after".');
		}

		// --- Read source file ---
		const sourceIsRemote = ctx.isSSHPath(filePath);
		let sourceFullPath: string;
		let sourceContent: string;
		if (sourceIsRemote) {
			sourceContent = await ctx.readRemoteFile(filePath);
			sourceFullPath = filePath;
		} else {
			sourceFullPath = ctx.resolvePath(filePath);
			if (!isAbsolute(filePath)) {
				await ctx.validatePath(sourceFullPath);
			}
			sourceContent = await readFileSmart(sourceFullPath);
		}

		const sourceLines = sourceContent.split('\n');
		const totalSourceLines = sourceLines.length;

		if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) {
			throw new Error('startLine and endLine must be integers.');
		}
		if (startLine < 1 || endLine < 1) {
			throw new Error('startLine and endLine are 1-indexed and must be >= 1.');
		}
		if (startLine > endLine) {
			throw new Error(
				`startLine (${startLine}) must be <= endLine (${endLine}).`,
			);
		}
		if (startLine > totalSourceLines) {
			throw new Error(
				`startLine ${startLine} is out of range (source has ${totalSourceLines} lines).`,
			);
		}

		const effectiveEndLine = Math.min(endLine, totalSourceLines);
		const startIdx = startLine - 1;
		const segmentLines = sourceLines.slice(startIdx, effectiveEndLine);
		if (segmentLines.length === 0) {
			throw new Error('Selected segment is empty.');
		}

		// --- Resolve target file ---
		const resolvedTargetPath = targetPath ?? filePath;
		const targetIsRemote = ctx.isSSHPath(resolvedTargetPath);
		let targetFullPath: string;
		if (targetIsRemote) {
			targetFullPath = resolvedTargetPath;
		} else {
			targetFullPath = ctx.resolvePath(resolvedTargetPath);
			if (!isAbsolute(resolvedTargetPath)) {
				await ctx.validatePath(targetFullPath);
			}
		}

		const isSameFile =
			sourceIsRemote === targetIsRemote && sourceFullPath === targetFullPath;

		const changedFiles: CopySegmentChangedFile[] = [];
		let sourceNewContent: string | undefined;
		let targetNewContent: string | undefined;

		if (isSameFile) {
			// --- Same file: move (cut) or duplicate (copy) ---
			const anchor = resolveInsertIndex(targetLine, position, totalSourceLines);
			const segmentEndIdx = startIdx + segmentLines.length;

			if (mode === 'cut') {
				if (anchor > startIdx && anchor < segmentEndIdx) {
					throw new Error(
						'Target position is inside the selected segment. Choose a target outside the cut range.',
					);
				}
				const remaining = [
					...sourceLines.slice(0, startIdx),
					...sourceLines.slice(segmentEndIdx),
				];
				let insertIdx = anchor;
				if (insertIdx >= segmentEndIdx) {
					insertIdx -= segmentLines.length;
				}
				insertIdx = Math.max(0, Math.min(remaining.length, insertIdx));
				const newLines = insertLines(remaining, insertIdx, segmentLines);
				sourceNewContent = newLines.join('\n');
				const from = Math.min(startLine, insertIdx + 1);
				const to = Math.max(effectiveEndLine, insertIdx + segmentLines.length);
				changedFiles.push({
					path: filePath,
					success: true,
					oldContent: sliceContextSnippet(sourceLines, from, to, contextLines),
					newContent: sliceContextSnippet(newLines, from, to, contextLines),
				});
			} else {
				const insertIdx = Math.max(0, Math.min(sourceLines.length, anchor));
				const newLines = insertLines(sourceLines, insertIdx, segmentLines);
				sourceNewContent = newLines.join('\n');
				const from = Math.min(startLine, insertIdx + 1);
				const to = Math.max(effectiveEndLine, insertIdx + segmentLines.length);
				changedFiles.push({
					path: filePath,
					success: true,
					oldContent: sliceContextSnippet(sourceLines, from, to, contextLines),
					newContent: sliceContextSnippet(newLines, from, to, contextLines),
				});
			}
		} else {
			// --- Cross-file: read target (may not exist yet) ---
			let targetContent: string | undefined;
			if (targetIsRemote) {
				try {
					targetContent = await ctx.readRemoteFile(targetFullPath);
				} catch {
					targetContent = undefined;
				}
			} else {
				try {
					targetContent = await readFileSmart(targetFullPath);
				} catch {
					targetContent = undefined;
				}
			}
			const targetExisted = targetContent !== undefined;
			const targetLines =
				targetContent !== undefined ? targetContent.split('\n') : [];

			const insertIdx = resolveInsertIndex(
				targetLine,
				position,
				targetLines.length,
			);
			const newTargetLines = insertLines(targetLines, insertIdx, segmentLines);
			targetNewContent = newTargetLines.join('\n');

			if (mode === 'cut') {
				const segmentEndIdx = startIdx + segmentLines.length;
				const newSourceLines = [
					...sourceLines.slice(0, startIdx),
					...sourceLines.slice(segmentEndIdx),
				];
				sourceNewContent = newSourceLines.join('\n');
				changedFiles.push({
					path: filePath,
					success: true,
					oldContent: sliceContextSnippet(
						sourceLines,
						startLine,
						effectiveEndLine,
						contextLines,
					),
					newContent: sliceContextSnippet(
						newSourceLines,
						startLine,
						startLine,
						contextLines,
					),
				});
			}

			changedFiles.push({
				path: resolvedTargetPath,
				success: true,
				oldContent: targetExisted
					? sliceContextSnippet(
							targetLines,
							insertIdx + 1,
							insertIdx + 1,
							contextLines,
					  )
					: '',
				newContent: sliceContextSnippet(
					newTargetLines,
					insertIdx + 1,
					insertIdx + segmentLines.length,
					contextLines,
				),
			});
		}

		// --- Auto-format then write mutated files ---
		const maybeFormat = async (
			fullPath: string,
			content: string,
		): Promise<string> => {
			const fileExtension = path.extname(fullPath).toLowerCase();
			const shouldFormat =
				getAutoFormatEnabled() &&
				ctx.prettierSupportedExtensions.includes(fileExtension);
			if (!shouldFormat) {
				return content;
			}
			try {
				const prettierConfig = await prettier.resolveConfig(fullPath);
				return await prettier.format(content, {
					filepath: fullPath,
					...prettierConfig,
				});
			} catch {
				return content;
			}
		};

		const writeFile = async (
			isRemote: boolean,
			fullPath: string,
			content: string,
		): Promise<void> => {
			if (isRemote) {
				await ctx.writeRemoteFile(fullPath, content);
			} else {
				await writeFileSmart(fullPath, content);
			}
		};

		if (sourceNewContent !== undefined) {
			const formatted = await maybeFormat(sourceFullPath, sourceNewContent);
			await backupFileBeforeMutation({
				filePath,
				basePath: ctx.basePath,
				fileExisted: true,
				originalContent: sourceContent,
			});
			await writeFile(sourceIsRemote, sourceFullPath, formatted);
		}

		if (targetNewContent !== undefined) {
			const formatted = await maybeFormat(targetFullPath, targetNewContent);
			let targetExisted = true;
			let targetOriginal: string | undefined;
			if (targetIsRemote) {
				try {
					targetOriginal = await ctx.readRemoteFile(targetFullPath);
				} catch {
					targetExisted = false;
				}
			} else {
				try {
					targetOriginal = await readFileSmart(targetFullPath);
				} catch {
					targetExisted = false;
				}
			}
			await backupFileBeforeMutation({
				filePath: resolvedTargetPath,
				basePath: ctx.basePath,
				fileExisted: targetExisted,
				originalContent: targetOriginal,
			});
			await writeFile(targetIsRemote, targetFullPath, formatted);
		}

		const successCount = changedFiles.filter(f => f.success).length;
		const failureCount = changedFiles.length - successCount;
		const totalLinesMoved = segmentLines.length;

		const message =
			`✅ Code segment ${mode === 'cut' ? 'cut' : 'copied'} successfully\\n` +
			`   Source: ${filePath} (lines ${startLine}-${effectiveEndLine}, ${totalLinesMoved} line(s))\\n` +
			`   Target: ${resolvedTargetPath}${
				targetLine !== undefined
					? ` (at line ${targetLine}, ${position})`
					: ' (end of file)'
			}\\n` +
			`   Files changed: ${successCount}`;

		return {
			message,
			filePath,
			results: changedFiles,
			totalFiles: changedFiles.length,
			successCount,
			failureCount,
			copiedContent: segmentLines.join('\n'),
			mode,
			sourceRange: {startLine, endLine: effectiveEndLine},
			targetLine: targetLine ?? 0,
			sourcePath: filePath,
			targetPath: resolvedTargetPath,
		};
	} catch (error) {
		throw new Error(
			`Failed to ${mode === 'cut' ? 'cut' : 'copy'} segment in ${filePath}: ${
				error instanceof Error ? error.message : 'Unknown error'
			}`,
		);
	}
}
