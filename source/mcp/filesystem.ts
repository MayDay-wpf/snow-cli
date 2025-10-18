import {promises as fs} from 'fs';
import * as path from 'path';
import {exec} from 'child_process';
import {promisify} from 'util';
import {vscodeConnection, type Diagnostic} from '../utils/vscodeConnection.js';
import {incrementalSnapshotManager} from '../utils/incrementalSnapshot.js';
import {
	tryUnescapeFix,
	trimPairIfPossible,
	isOverEscaped,
} from '../utils/escapeHandler.js';
const {resolve, dirname, isAbsolute} = path;
const execAsync = promisify(exec);

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

interface MatchCandidate {
	startLine: number;
	endLine: number;
	similarity: number;
	preview: string;
}

/**
 * Filesystem MCP Service
 * Provides basic file operations: read, create, and delete files
 */
export class FilesystemMCPService {
	private basePath: string;

	/**
	 * File extensions supported by Prettier for automatic formatting
	 */
	private readonly prettierSupportedExtensions = [
		'.js',
		'.jsx',
		'.ts',
		'.tsx',
		'.json',
		'.css',
		'.scss',
		'.less',
		'.html',
		'.vue',
		'.yaml',
		'.yml',
		'.md',
		'.graphql',
		'.gql',
	];

	constructor(basePath: string = process.cwd()) {
		this.basePath = resolve(basePath);
	}

	/**
	 * Calculate similarity between two strings using a smarter algorithm
	 * This normalizes whitespace first to avoid false negatives from spacing differences
	 * Returns a value between 0 (completely different) and 1 (identical)
	 */
	private calculateSimilarity(str1: string, str2: string): number {
		// Normalize whitespace for comparison: collapse all whitespace to single spaces
		const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
		const norm1 = normalize(str1);
		const norm2 = normalize(str2);

		const len1 = norm1.length;
		const len2 = norm2.length;

		if (len1 === 0) return len2 === 0 ? 1 : 0;
		if (len2 === 0) return 0;

		// Use Levenshtein distance for better similarity calculation
		const maxLen = Math.max(len1, len2);
		const distance = this.levenshteinDistance(norm1, norm2);

		return 1 - distance / maxLen;
	}

	/**
	 * Calculate Levenshtein distance between two strings
	 */
	private levenshteinDistance(str1: string, str2: string): number {
		const len1 = str1.length;
		const len2 = str2.length;

		// Create distance matrix
		const matrix: number[][] = [];
		for (let i = 0; i <= len1; i++) {
			matrix[i] = [i];
		}
		for (let j = 0; j <= len2; j++) {
			matrix[0]![j] = j;
		}

		// Fill matrix
		for (let i = 1; i <= len1; i++) {
			for (let j = 1; j <= len2; j++) {
				const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
				matrix[i]![j] = Math.min(
					matrix[i - 1]![j]! + 1, // deletion
					matrix[i]![j - 1]! + 1, // insertion
					matrix[i - 1]![j - 1]! + cost, // substitution
				);
			}
		}

		return matrix[len1]![len2]!;
	}

	/**
	 * Find the closest matching candidates in the file content
	 * Returns top N candidates sorted by similarity
	 */
	private findClosestMatches(
		searchContent: string,
		fileLines: string[],
		topN: number = 3,
	): MatchCandidate[] {
		const searchLines = searchContent.split('\n');
		const candidates: MatchCandidate[] = [];

		// Normalize whitespace for display only (makes preview more readable)
		const normalizeForDisplay = (line: string) =>
			line.replace(/\t/g, ' ').replace(/  +/g, ' ');

		// Try to find candidates by sliding window
		for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
			const candidateLines = fileLines.slice(i, i + searchLines.length);
			const candidateContent = candidateLines.join('\n');

			const similarity = this.calculateSimilarity(
				searchContent,
				candidateContent,
			);

			// Only consider candidates with >50% similarity
			if (similarity > 0.5) {
				candidates.push({
					startLine: i + 1,
					endLine: i + searchLines.length,
					similarity,
					preview: candidateLines
						.map((line, idx) => `${i + idx + 1}→${normalizeForDisplay(line)}`)
						.join('\n'),
				});
			}
		}

		// Sort by similarity descending and return top N
		return candidates
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, topN);
	}

	/**
	 * Generate a helpful diff message showing differences between search and actual content
	 * Note: This is ONLY for display purposes. Tabs/spaces are normalized for better readability.
	 */
	private generateDiffMessage(
		searchContent: string,
		actualContent: string,
		maxLines: number = 10,
	): string {
		const searchLines = searchContent.split('\n');
		const actualLines = actualContent.split('\n');
		const diffLines: string[] = [];

		const maxLen = Math.max(searchLines.length, actualLines.length);

		// Normalize whitespace for display only (makes diff more readable)
		const normalizeForDisplay = (line: string) =>
			line.replace(/\t/g, ' ').replace(/  +/g, ' ');

		for (let i = 0; i < Math.min(maxLen, maxLines); i++) {
			const searchLine = searchLines[i] || '';
			const actualLine = actualLines[i] || '';

			if (searchLine !== actualLine) {
				diffLines.push(`Line ${i + 1}:`);
				diffLines.push(
					`  Search: ${JSON.stringify(normalizeForDisplay(searchLine))}`,
				);
				diffLines.push(
					`  Actual: ${JSON.stringify(normalizeForDisplay(actualLine))}`,
				);
			}
		}

		if (maxLen > maxLines) {
			diffLines.push(`... (${maxLen - maxLines} more lines)`);
		}

		return diffLines.join('\n');
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

		// Note: Boundary checking removed - AI should be free to edit partial code blocks
		// The bracket balance check above is sufficient for detecting real issues

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
	 * Get the content of a file with optional line range
	 * @param filePath - Path to the file (relative to base path or absolute)
	 * @param startLine - Starting line number (1-indexed, inclusive, optional - defaults to 1)
	 * @param endLine - Ending line number (1-indexed, inclusive, optional - defaults to 500 or file end)
	 * @returns Object containing the requested content with line numbers and metadata
	 * @throws Error if file doesn't exist or cannot be read
	 */
	async getFileContent(
		filePath: string,
		startLine?: number,
		endLine?: number,
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

			// Default values and logic:
			// - No params: read entire file (1 to totalLines)
			// - Only startLine: read from startLine to end of file
			// - Both params: read from startLine to endLine
			const actualStartLine = startLine ?? 1;
			const actualEndLine = endLine ?? totalLines;

			// Validate and adjust line numbers
			if (actualStartLine < 1) {
				throw new Error('Start line must be greater than 0');
			}
			if (actualEndLine < actualStartLine) {
				throw new Error('End line must be greater than or equal to start line');
			}
			if (actualStartLine > totalLines) {
				throw new Error(
					`Start line ${actualStartLine} exceeds file length ${totalLines}`,
				);
			}

			const start = actualStartLine;
			const end = Math.min(totalLines, actualEndLine);

			// Extract specified lines (convert to 0-indexed) and add line numbers
			const selectedLines = lines.slice(start - 1, end);

			// Format with line numbers (no padding to save tokens)
			const numberedLines = selectedLines.map((line, index) => {
				const lineNum = start + index;
				return `${lineNum}→${line}`;
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
	 * Delete one or multiple files
	 * @param filePaths - Single file path or array of file paths to delete
	 * @returns Success message with details
	 * @throws Error if file deletion fails
	 */
	async deleteFile(filePaths: string | string[]): Promise<string> {
		try {
			const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
			const results: string[] = [];
			const errors: string[] = [];

			for (const filePath of paths) {
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
					results.push(`✅ ${filePath}`);
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : 'Unknown error';
					errors.push(`❌ ${filePath}: ${errorMsg}`);
				}
			}

			const summary = [];
			if (results.length > 0) {
				summary.push(
					`Successfully deleted ${results.length} file(s):\n${results.join(
						'\n',
					)}`,
				);
			}
			if (errors.length > 0) {
				summary.push(
					`Failed to delete ${errors.length} file(s):\n${errors.join('\n')}`,
				);
			}

			return summary.join('\n\n');
		} catch (error) {
			throw new Error(
				`Failed to delete files: ${
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
	 * Edit a file by searching for exact content and replacing it
	 * This method uses SMART MATCHING to handle whitespace differences automatically.
	 *
	 * @param filePath - Path to the file to edit
	 * @param searchContent - Content to search for (whitespace will be normalized automatically)
	 * @param replaceContent - New content to replace the search content with
	 * @param occurrence - Which occurrence to replace (1-indexed, default: 1, use -1 for all)
	 * @param contextLines - Number of context lines to return before and after the edit (default: 8)
	 * @returns Object containing success message, before/after comparison, and diagnostics
	 * @throws Error if search content is not found or multiple matches exist
	 */
	async editFileBySearch(
		filePath: string,
		searchContent: string,
		replaceContent: string,
		occurrence: number = 1,
		contextLines: number = 8,
	): Promise<{
		message: string;
		oldContent: string;
		newContent: string;
		replacedContent: string;
		matchLocation: {startLine: number; endLine: number};
		contextStartLine: number;
		contextEndLine: number;
		totalLines: number;
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

			// Normalize line endings
			let normalizedSearch = searchContent
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n');
			const normalizedContent = content
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n');

			// Split into lines for matching
			let searchLines = normalizedSearch.split('\n');
			const contentLines = normalizedContent.split('\n');

			// Find all matches using smart fuzzy matching (auto-handles whitespace)
			const matches: Array<{
				startLine: number;
				endLine: number;
				similarity: number;
			}> = [];
			const threshold = 0.6; // Lowered to 60% to allow smaller partial edits (was 0.75)

			for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
				const candidateLines = contentLines.slice(i, i + searchLines.length);
				const candidateContent = candidateLines.join('\n');
				const similarity = this.calculateSimilarity(
					normalizedSearch,
					candidateContent,
				);

				// Accept matches above threshold
				if (similarity >= threshold) {
					matches.push({
						startLine: i + 1,
						endLine: i + searchLines.length,
						similarity,
					});
				}
			}

			// Sort by similarity descending (best match first)
			matches.sort((a, b) => b.similarity - a.similarity);

			// Handle no matches: Try escape correction before giving up
			if (matches.length === 0) {
				// Step 1: Try unescape correction (lightweight, no LLM)
				const unescapeFix = tryUnescapeFix(
					normalizedContent,
					normalizedSearch,
					1,
				);
				if (unescapeFix) {
					// Unescape succeeded! Re-run the matching with corrected content
					const correctedSearchLines = unescapeFix.correctedString.split('\n');
					for (
						let i = 0;
						i <= contentLines.length - correctedSearchLines.length;
						i++
					) {
						const candidateLines = contentLines.slice(
							i,
							i + correctedSearchLines.length,
						);
						const candidateContent = candidateLines.join('\n');
						const similarity = this.calculateSimilarity(
							unescapeFix.correctedString,
							candidateContent,
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

					// If unescape fix worked, also fix replaceContent if needed
					if (matches.length > 0) {
						const trimResult = trimPairIfPossible(
							unescapeFix.correctedString,
							replaceContent,
							normalizedContent,
							1,
						);
						// Update searchContent and replaceContent for the edit
						normalizedSearch = trimResult.target;
						replaceContent = trimResult.paired;
						// Also update searchLines for later use
						searchLines.splice(
							0,
							searchLines.length,
							...normalizedSearch.split('\n'),
						);
					}
				}

				// If still no matches after unescape, provide detailed error
				if (matches.length === 0) {
					// Find closest matches for suggestions
					const closestMatches = this.findClosestMatches(
						normalizedSearch,
						normalizedContent.split('\n'),
						3,
					);

					let errorMessage = `❌ Search content not found in file: ${filePath}\n\n`;
					errorMessage += `🔍 Using smart fuzzy matching (threshold: 60%)\n`;
					if (isOverEscaped(searchContent)) {
						errorMessage += `⚠️  Detected over-escaped content, automatic fix attempted but failed\n`;
					}

					errorMessage += `\n`;

					if (closestMatches.length > 0) {
						errorMessage += `💡 Found ${closestMatches.length} similar location(s):\n\n`;
						closestMatches.forEach((candidate, idx) => {
							errorMessage += `${idx + 1}. Lines ${candidate.startLine}-${
								candidate.endLine
							} (${(candidate.similarity * 100).toFixed(0)}% match):\n`;
							errorMessage += `${candidate.preview}\n\n`;
						});

						// Show diff with the closest match
						const bestMatch = closestMatches[0];
						if (bestMatch) {
							const bestMatchLines = lines.slice(
								bestMatch.startLine - 1,
								bestMatch.endLine,
							);
							const bestMatchContent = bestMatchLines.join('\n');
							const diffMsg = this.generateDiffMessage(
								normalizedSearch,
								bestMatchContent,
								5,
							);
							if (diffMsg) {
								errorMessage += `📊 Difference with closest match:\n${diffMsg}\n\n`;
							}
						}
						errorMessage += `💡 Suggestions:\n`;
						errorMessage += `  • Make sure you copied content from filesystem_read (without "123→")\n`;
						errorMessage += `  • Whitespace differences are automatically handled\n`;
						errorMessage += `  • Try copying a larger or smaller code block\n`;
						errorMessage += `  • If multiple filesystem_edit_search attempts fail, use terminal_execute to edit via command line (e.g. sed, printf)\n`;

						errorMessage += `⚠️  No similar content found in the file.\n\n`;
						errorMessage += `📝 What you searched for (first 5 lines, formatted):\n`;
						const normalizeForDisplay = (line: string) =>
							line.replace(/\s+/g, ' ').trim();
						searchLines.slice(0, 5).forEach((line, idx) => {
							errorMessage += `${idx + 1}. ${JSON.stringify(
								normalizeForDisplay(line),
							)}\n`;
						});
						errorMessage += `\n💡 Copy exact content from filesystem_read (without line numbers)\n`;
					}

					throw new Error(errorMessage);
				}
			}

			// Handle occurrence selection
			let selectedMatch: {startLine: number; endLine: number};

			if (occurrence === -1) {
				// Replace all occurrences
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

			const {startLine, endLine} = selectedMatch;

			// Backup file before editing
			await incrementalSnapshotManager.backupFile(fullPath);

			// Perform the replacement by replacing the matched lines
			const normalizedReplace = replaceContent
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n');
			const beforeLines = lines.slice(0, startLine - 1);
			const afterLines = lines.slice(endLine);
			const replaceLines = normalizedReplace.split('\n');
			const modifiedLines = [...beforeLines, ...replaceLines, ...afterLines];
			const modifiedContent = modifiedLines.join('\n');

			// Calculate replaced content for display (compress whitespace for readability)
			const normalizeForDisplay = (line: string) => line.replace(/\s+/g, ' ');
			const replacedLines = lines.slice(startLine - 1, endLine);
			const replacedContent = replacedLines
				.map((line, idx) => {
					const lineNum = startLine + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
				})
				.join('\n');

			// Calculate context boundaries
			const lineDifference = replaceLines.length - (endLine - startLine + 1);

			const smartBoundaries = this.findSmartContextBoundaries(
				lines,
				startLine,
				endLine,
				contextLines,
			);
			const contextStart = smartBoundaries.start;
			const contextEnd = smartBoundaries.end;

			// Extract old content for context (compress whitespace for readability)
			const oldContextLines = lines.slice(contextStart - 1, contextEnd);
			const oldContent = oldContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
				})
				.join('\n');

			// Write the modified content
			await fs.writeFile(fullPath, modifiedContent, 'utf-8');

			// Format with Prettier asynchronously (non-blocking)
			let finalContent = modifiedContent;
			let finalLines = modifiedLines;
			let finalTotalLines = modifiedLines.length;
			let finalContextEnd = Math.min(
				finalTotalLines,
				contextEnd + lineDifference,
			);

			// Check if Prettier supports this file type
			const fileExtension = path.extname(fullPath).toLowerCase();
			const shouldFormat =
				this.prettierSupportedExtensions.includes(fileExtension);

			if (shouldFormat) {
				try {
					await execAsync(`npx prettier --write "${fullPath}"`, {
						encoding: 'utf-8',
					});

					// Re-read the file after formatting
					finalContent = await fs.readFile(fullPath, 'utf-8');
					finalLines = finalContent.split('\n');
					finalTotalLines = finalLines.length;

					finalContextEnd = Math.min(
						finalTotalLines,
						contextStart + (contextEnd - contextStart) + lineDifference,
					);
				} catch (formatError) {
					// Continue with unformatted content
				}
			}

			// Extract new content for context (compress whitespace for readability)
			const newContextLines = finalLines.slice(
				contextStart - 1,
				finalContextEnd,
			);
			const newContextContent = newContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
				})
				.join('\n');

			// Analyze code structure
			const editedContentLines = replaceLines;
			const structureAnalysis = this.analyzeCodeStructure(
				finalContent,
				filePath,
				editedContentLines,
			);

			// Get diagnostics from VS Code (non-blocking, fire-and-forget)
			let diagnostics: Diagnostic[] = [];
			try {
				// Request diagnostics without blocking (with timeout protection)
				const diagnosticsPromise = Promise.race([
					vscodeConnection.requestDiagnostics(fullPath),
					new Promise<Diagnostic[]>(resolve => setTimeout(() => resolve([]), 1000)), // 1s max wait
				]);
				diagnostics = await diagnosticsPromise;
			} catch (error) {
				// Ignore diagnostics errors - this is optional functionality
			}

			// Build result
			const result = {
				message:
					`✅ File edited successfully using search-replace (safer boundary detection): ${filePath}\n` +
					`   Matched: lines ${startLine}-${endLine} (occurrence ${occurrence}/${matches.length})\n` +
					`   Result: ${replaceLines.length} new lines` +
					(smartBoundaries.extended
						? `\n   📍 Context auto-extended to show complete code block (lines ${contextStart}-${finalContextEnd})`
						: ''),
				oldContent,
				newContent: newContextContent,
				replacedContent,
				matchLocation: {startLine, endLine},
				contextStartLine: contextStart,
				contextEndLine: finalContextEnd,
				totalLines: finalTotalLines,
				structureAnalysis,
				diagnostics: undefined as Diagnostic[] | undefined,
			};

			// Add diagnostics if found
			if (diagnostics.length > 0) {
				// Limit diagnostics to top 10 to avoid excessive token usage
				const limitedDiagnostics = diagnostics.slice(0, 10);
				result.diagnostics = limitedDiagnostics;

				const errorCount = diagnostics.filter(
					d => d.severity === 'error',
				).length;
				const warningCount = diagnostics.filter(
					d => d.severity === 'warning',
				).length;

				if (errorCount > 0 || warningCount > 0) {
					result.message += `\n\n⚠️  Diagnostics detected: ${errorCount} error(s), ${warningCount} warning(s)`;

					// Format diagnostics for better readability (limit to first 5 for message display)
					const formattedDiagnostics = diagnostics
						.filter(d => d.severity === 'error' || d.severity === 'warning')
						.slice(0, 5)
						.map(d => {
							const icon = d.severity === 'error' ? '❌' : '⚠️';
							const location = `${filePath}:${d.line}:${d.character}`;
							return `   ${icon} [${
								d.source || 'unknown'
							}] ${location}\n      ${d.message}`;
						})
						.join('\n\n');

					result.message += `\n\n📋 Diagnostic Details:\n${formattedDiagnostics}`;
					if (errorCount + warningCount > 5) {
						result.message += `\n   ... and ${
							errorCount + warningCount - 5
						} more issue(s)`;
					}
					result.message += `\n\n   ⚡ TIP: Review the errors above and make another edit to fix them`;
				}
			}

			// Add structure analysis warnings
			const structureWarnings: string[] = [];

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

			if (structureAnalysis.indentationWarnings.length > 0) {
				structureWarnings.push(
					...structureAnalysis.indentationWarnings.map(
						w => `Indentation: ${w}`,
					),
				);
			}

			// Note: Boundary warnings removed - partial edits are common and expected

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
			// Compress whitespace for display readability
			const normalizeForDisplay = (line: string) => line.replace(/\s+/g, ' ');
			const replacedLines = lines.slice(startLine - 1, adjustedEndLine);
			const replacedContent = replacedLines
				.map((line, idx) => {
					const lineNum = startLine + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
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

			// Extract old content for context (compress whitespace for readability)
			const oldContextLines = lines.slice(contextStart - 1, contextEnd);
			const oldContent = oldContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
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

			// Extract new content for context with line numbers (compress whitespace)
			const newContextLines = modifiedLines.slice(
				contextStart - 1,
				newContextEnd,
			);
			const newContextContent = newContextLines
				.map((line, idx) => {
					const lineNum = contextStart + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
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
			const fileExtension = path.extname(fullPath).toLowerCase();
			const shouldFormat =
				this.prettierSupportedExtensions.includes(fileExtension);

			if (shouldFormat) {
				try {
					await execAsync(`npx prettier --write "${fullPath}"`, {
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

					// Extract formatted content for context (compress whitespace)
					const formattedContextLines = finalLines.slice(
						contextStart - 1,
						finalContextEnd,
					);
					finalContextContent = formattedContextLines
						.map((line, idx) => {
							const lineNum = contextStart + idx;
							return `${lineNum}→${normalizeForDisplay(line)}`;
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

			// Try to get diagnostics from VS Code after editing (non-blocking)
			let diagnostics: Diagnostic[] = [];
			try {
				// Request diagnostics without blocking (with timeout protection)
				const diagnosticsPromise = Promise.race([
					vscodeConnection.requestDiagnostics(fullPath),
					new Promise<Diagnostic[]>(resolve => setTimeout(() => resolve([]), 1000)), // 1s max wait
				]);
				diagnostics = await diagnosticsPromise;
			} catch (error) {
				// Ignore diagnostics errors - they are optional
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
					`✅ File edited successfully,Please check the edit results and pay attention to code boundary issues to avoid syntax errors caused by missing closed parts: ${filePath}\n` +
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
				// Limit diagnostics to top 10 to avoid excessive token usage
				const limitedDiagnostics = diagnostics.slice(0, 10);
				result.diagnostics = limitedDiagnostics;

				const errorCount = diagnostics.filter(
					d => d.severity === 'error',
				).length;
				const warningCount = diagnostics.filter(
					d => d.severity === 'warning',
				).length;

				if (errorCount > 0 || warningCount > 0) {
					result.message += `\n\n⚠️  Diagnostics detected: ${errorCount} error(s), ${warningCount} warning(s)`;

					// Format diagnostics for better readability (limit to first 5 for message display)
					const formattedDiagnostics = diagnostics
						.filter(d => d.severity === 'error' || d.severity === 'warning')
						.slice(0, 5)
						.map(d => {
							const icon = d.severity === 'error' ? '❌' : '⚠️';
							const location = `${filePath}:${d.line}:${d.character}`;
							return `   ${icon} [${
								d.source || 'unknown'
							}] ${location}\n      ${d.message}`;
						})
						.join('\n\n');

					result.message += `\n\n📋 Diagnostic Details:\n${formattedDiagnostics}`;
					if (errorCount + warningCount > 5) {
						result.message += `\n   ... and ${
							errorCount + warningCount - 5
						} more issue(s)`;
					}
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

			// Note: Boundary warnings removed - partial edits are common and expected

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

export const mcpTools = [
	{
		name: 'filesystem_read',
		description:
			'📖 Read file content with line numbers. ⚠️ **IMPORTANT WORKFLOW**: (1) ALWAYS use ACE search tools FIRST (ace_text_search/ace_search_symbols/ace_file_outline) to locate the relevant code, (2) ONLY use filesystem_read when you know the approximate location and need precise line numbers for editing. **ANTI-PATTERN**: Reading files line-by-line from the top wastes tokens - use search instead! **USAGE**: Call without parameters to read entire file, or specify startLine/endLine for partial reads. Returns content with line numbers (format: "123→code") for precise editing.',
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
						'Optional: Starting line number (1-indexed). Omit to read from line 1.',
				},
				endLine: {
					type: 'number',
					description:
						'Optional: Ending line number (1-indexed). Omit to read to end of file.',
				},
			},
			required: ['filePath'],
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
		description:
			'Delete one or multiple files. Supports both single file and batch deletion.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description:
						'Path to a single file to delete (deprecated: use filePaths for single or multiple files)',
				},
				filePaths: {
					oneOf: [
						{
							type: 'string',
							description: 'Path to a single file to delete',
						},
						{
							type: 'array',
							items: {
								type: 'string',
							},
							description: 'Array of file paths to delete',
						},
					],
					description: 'Single file path or array of file paths to delete',
				},
			},
			// Make both optional, but at least one is required (validated in code)
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
		name: 'filesystem_edit_search',
		description:
			'🎯 **RECOMMENDED** for most edits: Search-and-replace with SMART FUZZY MATCHING that automatically handles whitespace differences. **WORKFLOW**: (1) Use ace_text_search/ace_search_symbols to locate code, (2) Use filesystem_read to view content, (3) Copy the code block you want to change (without line numbers), (4) Use THIS tool - whitespace will be normalized automatically. **WHY**: No line tracking, auto-handles spacing/tabs, finds best match. **BEST FOR**: Modifying functions, fixing bugs, updating logic.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					type: 'string',
					description: 'Path to the file to edit',
				},
				searchContent: {
					type: 'string',
					description:
						'Content to find and replace. Copy from filesystem_read output WITHOUT line numbers (e.g., "123→"). Whitespace differences are automatically handled - focus on getting the content right.',
				},
				replaceContent: {
					type: 'string',
					description:
						'New content to replace with. Indentation will be preserved automatically.',
				},
				occurrence: {
					type: 'number',
					description:
						'Which match to replace if multiple found (1-indexed). Default: 1 (best match first). Use -1 for all (not yet supported).',
					default: 1,
				},
				contextLines: {
					type: 'number',
					description: 'Context lines to show before/after (default: 8)',
					default: 8,
				},
			},
			required: ['filePath', 'searchContent', 'replaceContent'],
		},
	},
	{
		name: 'filesystem_edit',
		description:
			"🔧 Line-based editing for precise control. **WHEN TO USE**: (1) Adding completely new code sections, (2) Deleting specific line ranges, (3) When search-replace is not suitable. **WORKFLOW**: (1) Use ace_text_search/ace_file_outline to locate relevant area, (2) Use filesystem_read to get exact line numbers, (3) Use THIS tool with precise line ranges. **RECOMMENDATION**: For modifying existing code, use filesystem_edit_search instead - it's safer. **BEST PRACTICES**: Keep edits small (≤15 lines), double-check line numbers, verify bracket closure.",
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
];
