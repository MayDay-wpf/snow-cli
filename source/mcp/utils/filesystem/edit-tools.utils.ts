import * as path from 'path';
import * as prettier from 'prettier';
import {isAbsolute} from 'path';
import type {Diagnostic} from '../../../utils/ui/vscodeConnection.js';
import type {
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
	calculateSimilarityAsync,
	normalizeForDisplay,
} from '../../utils/filesystem/similarity.utils.js';
import {
	analyzeCodeStructure,
	findSmartContextBoundaries,
} from '../../utils/filesystem/code-analysis.utils.js';
import {
	findClosestMatches,
	generateDiffMessage,
} from '../../utils/filesystem/match-finder.utils.js';
import {readFileWithEncoding, writeFileWithEncoding} from '../../utils/filesystem/encoding.utils.js';
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

type EditToolContext = {
	basePath: string;
	prettierSupportedExtensions: string[];
	isSSHPath: (filePath: string) => boolean;
	readRemoteFile: (sshUrl: string) => Promise<string>;
	writeRemoteFile: (sshUrl: string, content: string) => Promise<void>;
	resolvePath: (filePath: string, contextPath?: string) => string;
	validatePath: (fullPath: string) => Promise<void>;
};

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
			content = await readFileWithEncoding(fullPath);
		}

		const lines = content.split('\n');
		await backupFileBeforeMutation({
			filePath,
			basePath: ctx.basePath,
			fileExisted: true,
			originalContent: content,
		});

		let normalizedSearch = searchContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		let searchLines = normalizedSearch.split('\n');
		const contentLines = normalizedContent.split('\n');

		const matches: Array<{startLine: number; endLine: number; similarity: number}> = [];
		const threshold = 0.75;
		const searchFirstLine = searchLines[0]?.replace(/\s+/g, ' ').trim() || '';
		const usePreFilter = searchLines.length >= 5;
		const preFilterThreshold = 0.2;
		const maxMatches = 10;

		for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
			if (usePreFilter) {
				const firstLineCandidate = contentLines[i]?.replace(/\s+/g, ' ').trim() || '';
				const firstLineSimilarity = calculateSimilarity(
					searchFirstLine,
					firstLineCandidate,
					preFilterThreshold,
				);
				if (firstLineSimilarity < preFilterThreshold) {
					continue;
				}
			}

			const candidateLines = contentLines.slice(i, i + searchLines.length);
			const candidateContent = candidateLines.join('\n');
			const similarity = await calculateSimilarityAsync(
				normalizedSearch,
				candidateContent,
				threshold,
			);

			if (similarity >= threshold) {
				matches.push({
					startLine: i + 1,
					endLine: i + searchLines.length,
					similarity,
				});
				if (similarity >= 0.95 || matches.length >= maxMatches) {
					break;
				}
			}
		}

		matches.sort((a, b) => b.similarity - a.similarity);

		if (matches.length === 0) {
			const unescapeFix = tryUnescapeFix(normalizedContent, normalizedSearch, 1);
			if (unescapeFix) {
				const correctedSearchLines = unescapeFix.correctedString.split('\n');
				for (let i = 0; i <= contentLines.length - correctedSearchLines.length; i++) {
					const candidateLines = contentLines.slice(i, i + correctedSearchLines.length);
					const similarity = await calculateSimilarityAsync(
						unescapeFix.correctedString,
						candidateLines.join('\n'),
					);
					if (similarity >= threshold) {
						matches.push({
							startLine: i + 1,
							endLine: i + correctedSearchLines.length,
							similarity,
						});
					}
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
						errorMessage += `${idx + 1}. Lines ${candidate.startLine}-${candidate.endLine} (${(candidate.similarity * 100).toFixed(0)}% match):\n`;
						errorMessage += `${candidate.preview}\n\n`;
					});

					const bestMatch = closestMatches[0];
					if (bestMatch) {
						const bestMatchContent = lines
							.slice(bestMatch.startLine - 1, bestMatch.endLine)
							.join('\n');
						const diffMsg = generateDiffMessage(normalizedSearch, bestMatchContent, 5);
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
						errorMessage += `${idx + 1}. ${JSON.stringify(normalizeForDisplay(line))}\n`;
					});
					errorMessage += `\n💡 Copy exact source text (not hashline-prefixed read lines)\n`;
				}
				throw new Error(errorMessage);
			}
		}

		let selectedMatch: {startLine: number; endLine: number};
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
				`Invalid occurrence ${occurrence}. Found ${matches.length} match(es) at lines: ${matches.map(m => m.startLine).join(', ')}`,
			);
		} else {
			selectedMatch = matches[occurrence - 1]!;
		}

		const {startLine, endLine} = selectedMatch;
		const normalizedReplace = replaceContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		const beforeLines = lines.slice(0, startLine - 1);
		const afterLines = lines.slice(endLine);
		let replaceLines = normalizedReplace.split('\n');

		if (replaceLines.length > 0) {
			const originalFirstLine = lines[startLine - 1];
			const originalIndent = originalFirstLine?.match(/^(\s*)/)?.[1] || '';
			const replaceFirstLine = replaceLines[0];
			const replaceIndent = replaceFirstLine?.match(/^(\s*)/)?.[1] || '';
			if (originalIndent !== replaceIndent && replaceFirstLine) {
				replaceLines[0] = originalIndent + replaceFirstLine.trim();
			}
		}

		const modifiedLines = [...beforeLines, ...replaceLines, ...afterLines];
		const modifiedContent = modifiedLines.join('\n');
		const replacedContent = lines.slice(startLine - 1, endLine).join('\n');
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
			await writeFileWithEncoding(fullPath, modifiedContent);
		}

		const diffContextEnd = Math.min(modifiedLines.length, contextEnd + lineDifference);
		let finalContent = modifiedContent;
		let finalLines = modifiedLines;
		let finalTotalLines = modifiedLines.length;
		const fileExtension = path.extname(fullPath).toLowerCase();
		const shouldFormat =
			getAutoFormatEnabled() && ctx.prettierSupportedExtensions.includes(fileExtension);

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
					await writeFileWithEncoding(fullPath, finalContent);
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
		const completeNewEnd = Math.min(modifiedLines.length, completeOldEnd + editLineDelta);
		const completeNewContent = modifiedLines
			.slice(completeNewStart - 1, completeNewEnd)
			.join('\n');

		const structureAnalysis = analyzeCodeStructure(finalContent, filePath, replaceLines);
		let diagnostics: Diagnostic[] = [];
		try {
			diagnostics = await getFreshDiagnostics(fullPath);
		} catch {
			// optional
		}

		const result = {
			message:
				`✅ File edited successfully using search-replace (safer boundary detection): ${filePath}\n` +
				`   Matched: lines ${startLine}-${endLine} (occurrence ${occurrence}/${matches.length})\n` +
				`   Result: ${replaceLines.length} new lines` +
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
			result.message = appendDiagnosticsSummary(result.message, filePath, diagnostics, {
				includeTip: true,
			});
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
			content = await readFileWithEncoding(fullPath);
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
					`Operation ${originalIndex + 1} (${op.type}): endAnchor is required. For a single-line replace or delete, set endAnchor to the same "lineNum:hash" as startAnchor. For insert_after, repeat startAnchor as endAnchor.`,
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

			if ((op.type === 'replace' || op.type === 'insert_after') && op.content === undefined) {
				anchorErrors.push(`Operation "${op.type}" requires content`);
			}

			if (hasValidRange) {
				preparedOps.push({op, originalIndex, startLine: startV.lineNum, endLine});
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
					current.startLine <= next.endLine && next.startLine <= current.endLine;
				if (!overlaps) continue;

				conflictErrors.push(
					`Operation ${current.originalIndex + 1} (${current.op.type} ${current.startLine}-${current.endLine}) conflicts with operation ${next.originalIndex + 1} (${next.op.type} ${next.startLine}-${next.endLine})`,
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
			if (aInsertAfter && bInsertAfter) return b.originalIndex - a.originalIndex;
			if (aInsertAfter !== bInsertAfter) return aInsertAfter ? -1 : 1;
			if (a.endLine !== b.endLine) return b.endLine - a.endLine;
			return b.originalIndex - a.originalIndex;
		});

		let editStartLine = Infinity;
		let editEndLine = 0;
		const mutableLines = [...lines];
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
					const newLines = sanitizeContent(op.content ?? '').split('\n');
					mutableLines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
					opSummaries.push(
						`replace lines ${startLine}-${endLine} → ${newLines.length} line(s)`,
					);
					break;
				}
				case 'insert_after': {
					const newLines = sanitizeContent(op.content ?? '').split('\n');
					mutableLines.splice(startLine, 0, ...newLines);
					opSummaries.push(`insert ${newLines.length} line(s) after line ${startLine}`);
					break;
				}
				case 'delete': {
					mutableLines.splice(startLine - 1, endLine - startLine + 1);
					opSummaries.push(`delete lines ${startLine}-${endLine}`);
					break;
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
			await writeFileWithEncoding(fullPath, modifiedContent);
		}

		let finalLines = mutableLines;
		let finalTotalLines = mutableLines.length;
		const lineDifference = mutableLines.length - lines.length;
		let finalContextEnd = Math.min(finalTotalLines, contextEnd + lineDifference);
		const fileExtension = path.extname(fullPath).toLowerCase();
		const shouldFormat =
			getAutoFormatEnabled() && ctx.prettierSupportedExtensions.includes(fileExtension);

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
					await writeFileWithEncoding(fullPath, formatted);
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
			result.message = appendDiagnosticsSummary(result.message, filePath, diagnostics, {
				headerLabel: 'Diagnostics',
				detailsLabel: 'Details',
				moreSuffix: 'more',
			});
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
