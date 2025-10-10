import {promises as fs} from 'fs';
import * as path from 'path';
import {execSync} from 'child_process';
import {vscodeConnection, type Diagnostic} from '../utils/vscodeConnection.js';
import {incrementalSnapshotManager} from '../utils/incrementalSnapshot.js';
import {multiLanguageASTParser} from './multiLanguageASTParser.js';
const {resolve, dirname, isAbsolute} = path;

interface SearchMatch {
	filePath: string;
	lineNumber: number;
	lineContent: string;
	column: number;
	matchedText?: string;
	nodeType?: string;
	nodeName?: string;
	language?: string;
}

interface SearchResult {
	query: string;
	totalMatches: number;
	matches: SearchMatch[];
	searchedFiles: number;
}

interface StructureAnalysis {
	bracketBalance: {
		curly: {open: number; close: number; balanced: boolean};
		round: {open: number; close: number; balanced: boolean};
		square: {open: number; close: number; balanced: boolean};
	};
	htmlTags?: {
		unclosedTags: string[];
		unopenedTags: string[];
		balanced: boolean;
	};
	indentationWarnings: string[];
	codeBlockBoundary?: {
		isInCompleteBlock: boolean;
		suggestion?: string;
	};
}

/**
 * Filesystem MCP Service
 * Provides basic file operations: read, create, and delete files
 */
export class FilesystemMCPService {
	private basePath: string;

	constructor(basePath: string = process.cwd()) {
		this.basePath = resolve(basePath);
	}

	/**
	 * Analyze code structure for balance and completeness
	 * Helps AI identify bracket mismatches, unclosed tags, and boundary issues
	 */
	private analyzeCodeStructure(
		_content: string,
		filePath: string,
		editedLines: string[],
	): StructureAnalysis {
		const analysis: StructureAnalysis = {
			bracketBalance: {
				curly: {open: 0, close: 0, balanced: true},
				round: {open: 0, close: 0, balanced: true},
				square: {open: 0, close: 0, balanced: true},
			},
			indentationWarnings: [],
		};

		// Count brackets in the edited content
		const editedContent = editedLines.join('\n');

		// Remove string literals and comments to avoid false positives
		const cleanContent = editedContent
			.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""') // Remove strings
			.replace(/\/\/.*$/gm, '') // Remove single-line comments
			.replace(/\/\*[\s\S]*?\*\//g, ''); // Remove multi-line comments

		// Count brackets
		analysis.bracketBalance.curly.open = (
			cleanContent.match(/\{/g) || []
		).length;
		analysis.bracketBalance.curly.close = (
			cleanContent.match(/\}/g) || []
		).length;
		analysis.bracketBalance.curly.balanced =
			analysis.bracketBalance.curly.open ===
			analysis.bracketBalance.curly.close;

		analysis.bracketBalance.round.open = (
			cleanContent.match(/\(/g) || []
		).length;
		analysis.bracketBalance.round.close = (
			cleanContent.match(/\)/g) || []
		).length;
		analysis.bracketBalance.round.balanced =
			analysis.bracketBalance.round.open ===
			analysis.bracketBalance.round.close;

		analysis.bracketBalance.square.open = (
			cleanContent.match(/\[/g) || []
		).length;
		analysis.bracketBalance.square.close = (
			cleanContent.match(/\]/g) || []
		).length;
		analysis.bracketBalance.square.balanced =
			analysis.bracketBalance.square.open ===
			analysis.bracketBalance.square.close;

		// HTML/JSX tag analysis (for .html, .jsx, .tsx, .vue files)
		const isMarkupFile = /\.(html|jsx|tsx|vue)$/i.test(filePath);
		if (isMarkupFile) {
			const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/g;
			const selfClosingPattern = /<[a-zA-Z][a-zA-Z0-9-]*[^>]*\/>/g;

			// Remove self-closing tags
			const contentWithoutSelfClosing = cleanContent.replace(
				selfClosingPattern,
				'',
			);

			const tags: string[] = [];
			const unclosedTags: string[] = [];
			const unopenedTags: string[] = [];

			let match;
			while ((match = tagPattern.exec(contentWithoutSelfClosing)) !== null) {
				const isClosing = match[0]?.startsWith('</');
				const tagName = match[1]?.toLowerCase();

				if (!tagName) continue;

				if (isClosing) {
					const lastOpenTag = tags.pop();
					if (!lastOpenTag || lastOpenTag !== tagName) {
						unopenedTags.push(tagName);
						if (lastOpenTag) tags.push(lastOpenTag); // Put it back
					}
				} else {
					tags.push(tagName);
				}
			}

			unclosedTags.push(...tags);

			analysis.htmlTags = {
				unclosedTags,
				unopenedTags,
				balanced: unclosedTags.length === 0 && unopenedTags.length === 0,
			};
		}

		// Check indentation consistency
		const lines = editedContent.split('\n');
		const indents = lines
			.filter(line => line.trim().length > 0)
			.map(line => {
				const match = line.match(/^(\s*)/);
				return match ? match[1] : '';
			})
			.filter((indent): indent is string => indent !== undefined);

		// Detect mixed tabs/spaces
		const hasTabs = indents.some(indent => indent.includes('\t'));
		const hasSpaces = indents.some(indent => indent.includes(' '));
		if (hasTabs && hasSpaces) {
			analysis.indentationWarnings.push('Mixed tabs and spaces detected');
		}

		// Detect inconsistent indentation levels (spaces only)
		if (!hasTabs && hasSpaces) {
			const spaceCounts = indents
				.filter(indent => indent.length > 0)
				.map(indent => indent.length);

			if (spaceCounts.length > 1) {
				const gcd = spaceCounts.reduce((a, b) => {
					while (b !== 0) {
						const temp = b;
						b = a % b;
						a = temp;
					}
					return a;
				});

				const hasInconsistent = spaceCounts.some(
					count => count % gcd !== 0 && gcd > 1,
				);
				if (hasInconsistent) {
					analysis.indentationWarnings.push(
						`Inconsistent indentation (expected multiples of ${gcd} spaces)`,
					);
				}
			}
		}

		// Check if edit is at a code block boundary
		const lastLine = editedLines[editedLines.length - 1]?.trim() || '';
		const firstLine = editedLines[0]?.trim() || '';

		const endsWithOpenBrace =
			lastLine.endsWith('{') ||
			lastLine.endsWith('(') ||
			lastLine.endsWith('[');
		const startsWithCloseBrace =
			firstLine.startsWith('}') ||
			firstLine.startsWith(')') ||
			firstLine.startsWith(']');

		if (endsWithOpenBrace || startsWithCloseBrace) {
			analysis.codeBlockBoundary = {
				isInCompleteBlock: false,
				suggestion: endsWithOpenBrace
					? 'Edit ends with an opening bracket - ensure the closing bracket is included in a subsequent edit or already exists in the file'
					: 'Edit starts with a closing bracket - ensure the opening bracket exists before this edit',
			};
		}

		return analysis;
	}

	/**
	 * Find smart context boundaries for editing
	 * Expands context to include complete code blocks when possible
	 */
	private findSmartContextBoundaries(
		lines: string[],
		startLine: number,
		endLine: number,
		requestedContext: number,
	): {start: number; end: number; extended: boolean} {
		const totalLines = lines.length;
		let contextStart = Math.max(1, startLine - requestedContext);
		let contextEnd = Math.min(totalLines, endLine + requestedContext);
		let extended = false;

		// Try to find the start of the enclosing block
		let bracketDepth = 0;
		for (let i = startLine - 1; i >= Math.max(0, startLine - 50); i--) {
			const line = lines[i];
			if (!line) continue;

			const trimmed = line.trim();

			// Count brackets (simple approach)
			const openBrackets = (line.match(/\{/g) || []).length;
			const closeBrackets = (line.match(/\}/g) || []).length;
			bracketDepth += closeBrackets - openBrackets;

			// If we find a function/class/block definition with balanced brackets
			if (
				bracketDepth === 0 &&
				(trimmed.match(
					/^(function|class|const|let|var|if|for|while|async|export)\s/i,
				) ||
					trimmed.match(/=>\s*\{/) ||
					trimmed.match(/^\w+\s*\(/))
			) {
				if (i + 1 < contextStart) {
					contextStart = i + 1;
					extended = true;
				}
				break;
			}
		}

		// Try to find the end of the enclosing block
		bracketDepth = 0;
		for (let i = endLine - 1; i < Math.min(totalLines, endLine + 50); i++) {
			const line = lines[i];
			if (!line) continue;

			const trimmed = line.trim();

			// Count brackets
			const openBrackets = (line.match(/\{/g) || []).length;
			const closeBrackets = (line.match(/\}/g) || []).length;
			bracketDepth += openBrackets - closeBrackets;

			// If we find a closing bracket at depth 0
			if (bracketDepth === 0 && trimmed.startsWith('}')) {
				if (i + 1 > contextEnd) {
					contextEnd = i + 1;
					extended = true;
				}
				break;
			}
		}

		return {start: contextStart, end: contextEnd, extended};
	}

	/**
	 * Get the content of a file with specified line range
	 * @param filePath - Path to the file (relative to base path or absolute)
	 * @param startLine - Starting line number (1-indexed, inclusive)
	 * @param endLine - Ending line number (1-indexed, inclusive)
	 * @returns Object containing the requested content with line numbers and metadata
	 * @throws Error if file doesn't exist or cannot be read
	 */
	async getFileContent(
		filePath: string,
		startLine: number,
		endLine: number,
	): Promise<{
		content: string;
		startLine: number;
		endLine: number;
		totalLines: number;
	}> {
		try {
			const fullPath = this.resolvePath(filePath);

			// For absolute paths, skip validation to allow access outside base path
			if (!isAbsolute(filePath)) {
				await this.validatePath(fullPath);
			}

			// Check if the path is a directory, if so, list its contents instead
			const stats = await fs.stat(fullPath);
			if (stats.isDirectory()) {
				const files = await this.listFiles(filePath);
				const fileList = files.join('\n');
				const lines = fileList.split('\n');
				return {
					content: `Directory: ${filePath}\n\n${fileList}`,
					startLine: 1,
					endLine: lines.length,
					totalLines: lines.length,
				};
			}

			const content = await fs.readFile(fullPath, 'utf-8');

			// Parse lines
			const lines = content.split('\n');
			const totalLines = lines.length;

			// Validate and adjust line numbers
			if (startLine < 1) {
				throw new Error('Start line must be greater than 0');
			}
			if (endLine < startLine) {
				throw new Error('End line must be greater than or equal to start line');
			}
			if (startLine > totalLines) {
				throw new Error(
					`Start line ${startLine} exceeds file length ${totalLines}`,
				);
			}

			const start = startLine;
			const end = Math.min(totalLines, endLine);

			// Extract specified lines (convert to 0-indexed) and add line numbers
			const selectedLines = lines.slice(start - 1, end);

			// Format with line numbers (similar to cat -n)
			// Calculate the width needed for line numbers
			const maxLineNumWidth = String(end).length;
			const numberedLines = selectedLines.map((line, index) => {
				const lineNum = start + index;
				const paddedLineNum = String(lineNum).padStart(maxLineNumWidth, ' ');
				return `${paddedLineNum}→${line}`;
			});

			const partialContent = numberedLines.join('\n');

			return {
				content: partialContent,
				startLine: start,
				endLine: end,
				totalLines,
			};
		} catch (error) {
			throw new Error(
				`Failed to read file ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	/**
	 * Create a new file with specified content
	 * @param filePath - Path where the file should be created
	 * @param content - Content to write to the file
	 * @param createDirectories - Whether to create parent directories if they don't exist
	 * @returns Success message
	 * @throws Error if file creation fails
	 */
	async createFile(
		filePath: string,
		content: string,
		createDirectories: boolean = true,
	): Promise<string> {
		try {
			const fullPath = this.resolvePath(filePath);

			// Check if file already exists
			try {
				await fs.access(fullPath);
				throw new Error(`File already exists: ${filePath}`);
			} catch (error) {
				// File doesn't exist, which is what we want
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}

			// Backup file before creation
			await incrementalSnapshotManager.backupFile(fullPath);

			// Create parent directories if needed
			if (createDirectories) {
				const dir = dirname(fullPath);
				await fs.mkdir(dir, {recursive: true});
			}

			await fs.writeFile(fullPath, content, 'utf-8');
			return `File created successfully: ${filePath}`;
		} catch (error) {
			throw new Error(
				`Failed to create file ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	/**
	 * Delete a file
	 * @param filePath - Path to the file to delete
	 * @returns Success message
	 * @throws Error if file deletion fails
	 */
	async deleteFile(filePath: string): Promise<string> {
		try {
			const fullPath = this.resolvePath(filePath);
			await this.validatePath(fullPath);

			const stats = await fs.stat(fullPath);
			if (!stats.isFile()) {
				throw new Error(`Path is not a file: ${filePath}`);
			}

			// Backup file before deletion
			await incrementalSnapshotManager.backupFile(fullPath);

			await fs.unlink(fullPath);
			return `File deleted successfully: ${filePath}`;
		} catch (error) {
			throw new Error(
				`Failed to delete file ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	/**
	 * List files in a directory
	 * @param dirPath - Directory path relative to base path or absolute path
	 * @returns Array of file names
	 * @throws Error if directory cannot be read
	 */
	async listFiles(dirPath: string = '.'): Promise<string[]> {
		try {
			const fullPath = this.resolvePath(dirPath);

			// For absolute paths, skip validation to allow access outside base path
			if (!isAbsolute(dirPath)) {
				await this.validatePath(fullPath);
			}

			const stats = await fs.stat(fullPath);
			if (!stats.isDirectory()) {
				throw new Error(`Path is not a directory: ${dirPath}`);
			}

			const files = await fs.readdir(fullPath);
			return files;
		} catch (error) {
			throw new Error(
				`Failed to list files in ${dirPath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	/**
	 * Check if a file or directory exists
	 * @param filePath - Path to check
	 * @returns Boolean indicating existence
	 */
	async exists(filePath: string): Promise<boolean> {
		try {
			const fullPath = this.resolvePath(filePath);
			await fs.access(fullPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get file information (stats)
	 * @param filePath - Path to the file
	 * @returns File stats object
	 * @throws Error if file doesn't exist
	 */
	async getFileInfo(filePath: string): Promise<{
		size: number;
		isFile: boolean;
		isDirectory: boolean;
		modified: Date;
		created: Date;
	}> {
		try {
			const fullPath = this.resolvePath(filePath);
			await this.validatePath(fullPath);

			const stats = await fs.stat(fullPath);
			return {
				size: stats.size,
				isFile: stats.isFile(),
				isDirectory: stats.isDirectory(),
				modified: stats.mtime,
				created: stats.birthtime,
			};
		} catch (error) {
			throw new Error(
				`Failed to get file info for ${filePath}: ${
					error instanceof Error ? error.message : 'Unknown error'
				}`,
			);
		}
	}

	/**
	 * Edit a file by replacing lines within a specified range
	 * BEST PRACTICE: Keep edits small and focused (≤15 lines recommended) for better accuracy.
	 * For larger changes, make multiple parallel edits to non-overlapping sections instead of one large edit.
	 *
	 * @param filePath - Path to the file to edit
	 * @param startLine - Starting line number (1-indexed, inclusive) - get from filesystem_read output
	 * @param endLine - Ending line number (1-indexed, inclusive) - get from filesystem_read output
	 * @param newContent - New content to replace the specified lines (WITHOUT line numbers)
	 * @param contextLines - Number of context lines to return before and after the edit (default: 8)
	 * @returns Object containing success message, precise before/after comparison, and diagnostics
	 * @throws Error if file editing fails
	 */
	async editFile(
		filePath: string,
		startLine: number,
		endLine: number,
		newContent: string,
		contextLines: number = 8,
	): Promise<{
		message: string;
		oldContent: string;
		newContent: string;
		replacedLines: string;
		contextStartLine: number;
		contextEndLine: number;
		totalLines: number;
		linesModified: number;
		structureAnalysis?: StructureAnalysis;
		diagnostics?: Diagnostic[];
	}> {
		try {
			const fullPath = this.resolvePath(filePath);

			// For absolute paths, skip validation to allow access outside base path
			if (!isAbsolute(filePath)) {
				await this.validatePath(fullPath);
			}

			// Read the entire file
			const content = await fs.readFile(fullPath, 'utf-8');
			const lines = content.split('\n');
			const totalLines = lines.length;

			// Validate line numbers
			if (startLine < 1 || endLine < 1) {
				throw new Error('Line numbers must be greater than 0');
			}
			if (startLine > endLine) {
				throw new Error('Start line must be less than or equal to end line');
			}
			if (startLine > totalLines) {
				throw new Error(
					`Start line ${startLine} exceeds file length ${totalLines}`,
				);
			}

			// Adjust endLine if it exceeds file length
			const adjustedEndLine = Math.min(endLine, totalLines);
			const linesToModify = adjustedEndLine - startLine + 1;

			// Backup file before editing
			await incrementalSnapshotManager.backupFile(fullPath);

			// Extract the lines that will be replaced (for comparison)
			const replacedLines = lines.slice(startLine - 1, adjustedEndLine);
			const replacedContent = replacedLines
				.map((line, idx) => {
					const lineNum = startLine + idx;
					const paddedNum = String(lineNum).padStart(
						String(adjustedEndLine).length,
						' ',
					);
					return `${paddedNum}→${line}`;
				})
				.join('\n');

			// Calculate context range using smart boundary detection
			const smartBoundaries = this.findSmartContextBoundaries(
				lines,
				startLine,
				adjustedEndLine,
				contextLines,
			);
			const contextStart = smartBoundaries.start;
			const contextEnd = smartBoundaries.end;

			// Extract old content for context (including the lines to be replaced)
			const oldContextLines = lines.slice(contextStart - 1, contextEnd);
			const oldContent = oldContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					const paddedNum = String(lineNum).padStart(
						String(contextEnd).length,
						' ',
					);
					return `${paddedNum}→${line}`;
				})
				.join('\n');

			// Replace the specified lines
			const newContentLines = newContent.split('\n');
			const beforeLines = lines.slice(0, startLine - 1);
			const afterLines = lines.slice(adjustedEndLine);
			const modifiedLines = [...beforeLines, ...newContentLines, ...afterLines];

			// Calculate new context range
			const newTotalLines = modifiedLines.length;
			const lineDifference =
				newContentLines.length - (adjustedEndLine - startLine + 1);
			const newContextEnd = Math.min(
				newTotalLines,
				contextEnd + lineDifference,
			);

			// Extract new content for context with line numbers
			const newContextLines = modifiedLines.slice(
				contextStart - 1,
				newContextEnd,
			);
			const newContextContent = newContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					const paddedNum = String(lineNum).padStart(
						String(newContextEnd).length,
						' ',
					);
					return `${paddedNum}→${line}`;
				})
				.join('\n');

			// Write the modified content back to file
			await fs.writeFile(fullPath, modifiedLines.join('\n'), 'utf-8');

			// Format the file with Prettier after editing to ensure consistent code style
			let finalLines = modifiedLines;
			let finalTotalLines = newTotalLines;
			let finalContextEnd = newContextEnd;
			let finalContextContent = newContextContent;

			// Check if Prettier supports this file type
			const prettierSupportedExtensions = [
				'.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less',
				'.html', '.vue', '.yaml', '.yml', '.md', '.graphql', '.gql'
			];
			const fileExtension = path.extname(fullPath).toLowerCase();
			const shouldFormat = prettierSupportedExtensions.includes(fileExtension);

			if (shouldFormat) {
				try {
					execSync(`npx prettier --write "${fullPath}"`, {
						stdio: 'pipe',
						encoding: 'utf-8',
					});

					// Re-read the file after formatting to get the formatted content
					const formattedContent = await fs.readFile(fullPath, 'utf-8');
					finalLines = formattedContent.split('\n');
					finalTotalLines = finalLines.length;

					// Recalculate the context end line based on formatted content
					finalContextEnd = Math.min(
						finalTotalLines,
						contextStart + (newContextEnd - contextStart),
					);

					// Extract formatted content for context with line numbers
					const formattedContextLines = finalLines.slice(
						contextStart - 1,
						finalContextEnd,
					);
					finalContextContent = formattedContextLines
						.map((line, idx) => {
							const lineNum = contextStart + idx;
							const paddedNum = String(lineNum).padStart(
								String(finalContextEnd).length,
								' ',
							);
							return `${paddedNum}→${line}`;
						})
						.join('\n');
				} catch (formatError) {
					// If formatting fails, continue with the original content
					// This ensures editing is not blocked by formatting issues
				}
			}

			// Analyze code structure of the edited content (using formatted content if available)
			const editedContentLines = finalLines.slice(
				startLine - 1,
				startLine - 1 + newContentLines.length,
			);
			const structureAnalysis = this.analyzeCodeStructure(
				finalLines.join('\n'),
				filePath,
				editedContentLines,
			);

			// Try to get diagnostics from VS Code after editing
			let diagnostics: Diagnostic[] = [];
			try {
				// Wait a bit for VS Code to process the file change
				await new Promise(resolve => setTimeout(resolve, 500));
				diagnostics = await vscodeConnection.requestDiagnostics(fullPath);
			} catch (error) {
				// Ignore diagnostics errors, they are optional
			}

			const result: {
				message: string;
				oldContent: string;
				newContent: string;
				replacedLines: string;
				contextStartLine: number;
				contextEndLine: number;
				totalLines: number;
				linesModified: number;
				structureAnalysis?: StructureAnalysis;
				diagnostics?: Diagnostic[];
			} = {
				message:
					`✅ File edited successfully: ${filePath}\n` +
					`   Replaced: lines ${startLine}-${adjustedEndLine} (${linesToModify} lines)\n` +
					`   Result: ${newContentLines.length} new lines` +
					(smartBoundaries.extended
						? `\n   📍 Context auto-extended to show complete code block (lines ${contextStart}-${finalContextEnd})`
						: ''),
				oldContent,
				newContent: finalContextContent,
				replacedLines: replacedContent,
				contextStartLine: contextStart,
				contextEndLine: finalContextEnd,
				totalLines: finalTotalLines,
				linesModified: linesToModify,
				structureAnalysis,
			};

			// Add diagnostics if any were found
			if (diagnostics.length > 0) {
				result.diagnostics = diagnostics;
				const errorCount = diagnostics.filter(
					d => d.severity === 'error',
				).length;
				const warningCount = diagnostics.filter(
					d => d.severity === 'warning',
				).length;

				if (errorCount > 0 || warningCount > 0) {
					result.message += `\n\n⚠️  Diagnostics detected: ${errorCount} error(s), ${warningCount} warning(s)`;

					// Format diagnostics for better readability
					const formattedDiagnostics = diagnostics
						.filter(d => d.severity === 'error' || d.severity === 'warning')
						.map(d => {
							const icon = d.severity === 'error' ? '❌' : '⚠️';
							const location = `${filePath}:${d.line}:${d.character}`;
							return `   ${icon} [${
								d.source || 'unknown'
							}] ${location}\n      ${d.message}`;
						})
						.join('\n\n');

					result.message += `\n\n📋 Diagnostic Details:\n${formattedDiagnostics}`;
					result.message += `\n\n   ⚡ TIP: Review the errors above and make another small edit to fix them`;
				}
			}

			// Add structure analysis warnings to the message
			const structureWarnings: string[] = [];

			// Check bracket balance
			if (!structureAnalysis.bracketBalance.curly.balanced) {
				const diff =
					structureAnalysis.bracketBalance.curly.open -
					structureAnalysis.bracketBalance.curly.close;
				structureWarnings.push(
					`Curly brackets: ${
						diff > 0 ? `${diff} unclosed {` : `${Math.abs(diff)} extra }`
					}`,
				);
			}
			if (!structureAnalysis.bracketBalance.round.balanced) {
				const diff =
					structureAnalysis.bracketBalance.round.open -
					structureAnalysis.bracketBalance.round.close;
				structureWarnings.push(
					`Round brackets: ${
						diff > 0 ? `${diff} unclosed (` : `${Math.abs(diff)} extra )`
					}`,
				);
			}
			if (!structureAnalysis.bracketBalance.square.balanced) {
				const diff =
					structureAnalysis.bracketBalance.square.open -
					structureAnalysis.bracketBalance.square.close;
				structureWarnings.push(
					`Square brackets: ${
						diff > 0 ? `${diff} unclosed [` : `${Math.abs(diff)} extra ]`
					}`,
				);
			}

			// Check HTML tags
			if (structureAnalysis.htmlTags && !structureAnalysis.htmlTags.balanced) {
				if (structureAnalysis.htmlTags.unclosedTags.length > 0) {
					structureWarnings.push(
						`Unclosed HTML tags: ${structureAnalysis.htmlTags.unclosedTags.join(
							', ',
						)}`,
					);
				}
				if (structureAnalysis.htmlTags.unopenedTags.length > 0) {
					structureWarnings.push(
						`Unopened closing tags: ${structureAnalysis.htmlTags.unopenedTags.join(
							', ',
						)}`,
					);
				}
			}

			// Check indentation
			if (structureAnalysis.indentationWarnings.length > 0) {
				structureWarnings.push(
					...structureAnalysis.indentationWarnings.map(
						w => `Indentation: ${w}`,
					),
				);
			}

			// Add code block boundary warnings
			if (
				structureAnalysis.codeBlockBoundary &&
				structureAnalysis.codeBlockBoundary.suggestion
			) {
				structureWarnings.push(
					`Boundary: ${structureAnalysis.codeBlockBoundary.suggestion}`,
				);
			}

			// Format structure warnings
			if (structureWarnings.length > 0) {
				result.message += `\n\n🔍 Structure Analysis:\n`;
				structureWarnings.forEach(warning => {
					result.message += `   ⚠️  ${warning}\n`;
				});
				result.message += `\n   💡 TIP: These warnings help identify potential issues. If intentional (e.g., opening a block), you can ignore them.`;
			}

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
	 * Search for code keywords in files within a directory
	 * @param query - Search keyword or pattern
	 * @param dirPath - Directory to search in (default: current directory)
	 * @param fileExtensions - Array of file extensions to search (e.g., ['.ts', '.tsx', '.js']). If empty, search all files.
	 * @param caseSensitive - Whether the search should be case-sensitive (default: false)
	 * @param maxResults - Maximum number of results to return (default: 100)
	 * @returns Search results with file paths, line numbers, and matched content
	 */
	async searchCode(
		query: string,
		dirPath: string = '.',
		fileExtensions: string[] = [],
		caseSensitive: boolean = false,
		maxResults: number = 100,
		searchMode: 'text' | 'regex' | 'ast' = 'text',
	): Promise<SearchResult> {
		const matches: SearchMatch[] = [];
		let searchedFiles = 0;
		const fullDirPath = this.resolvePath(dirPath);

		// Prepare search regex based on mode
		const flags = caseSensitive ? 'g' : 'gi';
		let searchRegex: RegExp | null = null;

		if (searchMode === 'text') {
			// Escape special regex characters for literal text search
			searchRegex = new RegExp(
				query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
				flags,
			);
		} else if (searchMode === 'regex') {
			// Use query as-is for regex search
			searchRegex = new RegExp(query, flags);
		}

		// Recursively search files
		const searchInDirectory = async (currentPath: string): Promise<void> => {
			try {
				const entries = await fs.readdir(currentPath, {withFileTypes: true});

				for (const entry of entries) {
					if (matches.length >= maxResults) {
						return;
					}

					const fullPath = path.join(currentPath, entry.name);

					// Skip common directories that should be ignored
					if (entry.isDirectory()) {
						const dirName = entry.name;
						if (
							dirName === 'node_modules' ||
							dirName === '.git' ||
							dirName === 'dist' ||
							dirName === 'build' ||
							dirName.startsWith('.')
						) {
							continue;
						}
						await searchInDirectory(fullPath);
					} else if (entry.isFile()) {
						// Filter by file extension if specified
						if (fileExtensions.length > 0) {
							const ext = path.extname(entry.name);
							if (!fileExtensions.includes(ext)) {
								continue;
							}
						}

						searchedFiles++;

						try {
							const content = await fs.readFile(fullPath, 'utf-8');

							// AST search mode - supports multiple languages via tree-sitter
							if (searchMode === 'ast') {
								// Check if file is supported for AST parsing
								if (multiLanguageASTParser.isSupported(fullPath)) {
									try {
										const astResults = multiLanguageASTParser.searchAST(
											content,
											fullPath,
											query,
											caseSensitive,
										);

										for (const result of astResults) {
											if (matches.length >= maxResults) {
												break;
											}

											const lineContent =
												content.split('\n')[result.startPosition.line - 1] ||
												'';

											matches.push({
												filePath: path.relative(this.basePath, fullPath),
												lineNumber: result.startPosition.line,
												lineContent: lineContent.trim(),
												column: result.startPosition.column,
												matchedText: result.name,
												nodeType: result.type,
												nodeName: result.name,
												language: result.language,
											});
										}
									} catch (error) {
										// Skip files with AST parsing errors
									}
								}
							} else if (searchRegex) {
								// Text or Regex search mode
								const lines = content.split('\n');

								lines.forEach((line, index) => {
									if (matches.length >= maxResults) {
										return;
									}

									// Reset regex for each line
									searchRegex!.lastIndex = 0;
									const match = searchRegex!.exec(line);

									if (match) {
										matches.push({
											filePath: path.relative(this.basePath, fullPath),
											lineNumber: index + 1,
											lineContent: line.trim(),
											column: match.index + 1,
											matchedText: match[0],
										});
									}
								});
							}
						} catch (error) {
							// Skip files that cannot be read (binary files, permission issues, etc.)
						}
					}
				}
			} catch (error) {
				// Skip directories that cannot be accessed
			}
		};

		await searchInDirectory(fullDirPath);

		return {
			query,
			totalMatches: matches.length,
			matches,
			searchedFiles,
		};
	}

	/**
	 * Resolve path relative to base path and normalize it
	 * @private
	 */
	private resolvePath(filePath: string): string {
		// Check if the path is already absolute
		const isAbsolute = path.isAbsolute(filePath);

		if (isAbsolute) {
			// Return absolute path as-is (will be validated later)
			return resolve(filePath);
		}

		// For relative paths, resolve against base path
		// Remove any leading slashes to treat as relative path
		const relativePath = filePath.replace(/^\/+/, '');
		return resolve(this.basePath, relativePath);
	}

	/**
	 * Validate that the path is within the allowed base directory
	 * @private
	 */
	private async validatePath(fullPath: string): Promise<void> {
		const normalizedPath = resolve(fullPath);
		const normalizedBase = resolve(this.basePath);

		if (!normalizedPath.startsWith(normalizedBase)) {
			throw new Error('Access denied: Path is outside of allowed directory');
		}
	}
}

// Export a default instance
export const filesystemService = new FilesystemMCPService();

// MCP Tool definitions for integration
export const mcpTools = [
	{
		name: 'filesystem_read',
		description:
			'Read the content of a file within specified line range. The returned content includes line numbers (format: "lineNum→content") for precise editing. You MUST specify startLine and endLine. To read the entire file, use startLine=1 and a large endLine value (e.g., 500). IMPORTANT: When you need to edit a file, you MUST read it first to see the exact line numbers and current content. NOTE: If the path points to a directory, this tool will automatically list its contents instead of throwing an error.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path to the file to read (or directory to list)',
				},
				startLine: {
					type: 'number',
					description:
						'Starting line number (1-indexed, inclusive). Must be >= 1.',
				},
				endLine: {
					type: 'number',
					description:
						'Ending line number (1-indexed, inclusive). Can exceed file length (will be capped automatically).',
				},
			},
			required: ['filePath', 'startLine', 'endLine'],
		},
	},
	{
		name: 'filesystem_create',
		description:
			'PREFERRED tool for file creation: Create a new file with specified content. More reliable than terminal commands like echo/cat with redirects. Automatically creates parent directories if needed. Terminal commands can be used as a fallback if needed.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path where the file should be created',
				},
				content: {
					type: 'string',
					description: 'Content to write to the file',
				},
				createDirectories: {
					type: 'boolean',
					description:
						"Whether to create parent directories if they don't exist",
					default: true,
				},
			},
			required: ['filePath', 'content'],
		},
	},
	{
		name: 'filesystem_delete',
		description: 'Delete a file',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path to the file to delete',
				},
			},
			required: ['filePath'],
		},
	},
	{
		name: 'filesystem_list',
		description: 'List files in a directory',
		inputSchema: {
			type: 'object',
			properties: {
				dirPath: {
					type: 'string',
					description: 'Directory path to list files from',
					default: '.',
				},
			},
		},
	},
	{
		name: 'filesystem_edit',
		description:
			'🎯 PREFERRED tool for precise file editing with intelligent feedback. **BEST PRACTICES**: (1) Use SMALL, INCREMENTAL edits (recommended ≤15 lines per edit) - SAFER and MORE ACCURATE, preventing syntax errors. (2) For large changes, make MULTIPLE PARALLEL edits to different sections instead of one large edit. (3) Must use exact line numbers  Code boundaries should not be redundant or missing, such as `{}` or HTML tags causing syntax errors. **WORKFLOW**: (1) Read target section with filesystem_read, (2) Edit small sections, (3) Review auto-generated structure analysis and diagnostics, (4) Make parallel edits to non-overlapping ranges if needed. **SMART FEATURES**: Auto-detects bracket/tag mismatches, indentation issues, and code block boundaries. Context auto-extends to show complete functions/classes when detected.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path to the file to edit (absolute or relative)',
				},
				startLine: {
					type: 'number',
					description:
						'⚠️  CRITICAL: Starting line number (1-indexed, inclusive). MUST match exact line number from filesystem_read output. Double-check this value!',
				},
				endLine: {
					type: 'number',
					description:
						'⚠️  CRITICAL: Ending line number (1-indexed, inclusive). MUST match exact line number from filesystem_read output. 💡 TIP: Keep edits small (≤15 lines recommended) for better accuracy.',
				},
				newContent: {
					type: 'string',
					description:
						'New content to replace specified lines. ⚠️  Do NOT include line numbers. ⚠️  Ensure proper indentation and bracket closure. Keep changes MINIMAL and FOCUSED.',
				},
				contextLines: {
					type: 'number',
					description:
						'Number of context lines to show before/after edit for verification (default: 8)',
					default: 8,
				},
			},
			required: ['filePath', 'startLine', 'endLine', 'newContent'],
		},
	},
	{
		name: 'filesystem_search',
		description:
			"Search for code keywords across files in a directory. Useful for finding function definitions, variable usages, or any code patterns. Similar to VS Code's global search feature.",
		inputSchema: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'The keyword or text to search for (e.g., function name, variable name, or any code pattern)',
				},
				dirPath: {
					type: 'string',
					description:
						'Directory to search in (relative to base path or absolute). Defaults to current directory.',
					default: '.',
				},
				fileExtensions: {
					type: 'array',
					items: {
						type: 'string',
					},
					description:
						'Array of file extensions to search (e.g., [".ts", ".tsx", ".js"]). If empty, searches all text files.',
					default: [],
				},
				caseSensitive: {
					type: 'boolean',
					description: 'Whether the search should be case-sensitive',
					default: false,
				},
				maxResults: {
					type: 'number',
					description: 'Maximum number of results to return',
					default: 100,
				},
				searchMode: {
					type: 'string',
					enum: ['text', 'regex', 'ast'],
					description:
						'Search mode: "text" for literal text search (default), "regex" for regular expression search, "ast" for AST-based semantic search (supports function/class/variable names)',
					default: 'text',
				},
			},
			required: ['query'],
		},
	},
];
