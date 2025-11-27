import {promises as fs} from 'fs';
import * as path from 'path';
import * as prettier from 'prettier';
// IDE connection supports both VSCode and JetBrains IDEs
import {
	vscodeConnection,
	type Diagnostic,
} from '../utils/ui/vscodeConnection.js';
import {incrementalSnapshotManager} from '../utils/codebase/incrementalSnapshot.js';
import {
	tryUnescapeFix,
	trimPairIfPossible,
	isOverEscaped,
} from '../utils/ui/escapeHandler.js';
// Type definitions
import type {
	EditBySearchConfig,
	EditByLineConfig,
	EditBySearchResult,
	EditByLineResult,
	EditBySearchSingleResult,
	EditByLineSingleResult,
	EditBySearchBatchResultItem,
	EditByLineBatchResultItem,
	SingleFileReadResult,
	MultipleFilesReadResult,
	MultimodalContent,
	ImageContent,
} from './types/filesystem.types.js';
import {IMAGE_MIME_TYPES, OFFICE_FILE_TYPES} from './types/filesystem.types.js';
// Utility functions
import {
	calculateSimilarity,
	calculateSimilarityAsync,
	normalizeForDisplay,
} from './utils/filesystem/similarity.utils.js';
import {
	analyzeCodeStructure,
	findSmartContextBoundaries,
} from './utils/filesystem/code-analysis.utils.js';
import {
	findClosestMatches,
	generateDiffMessage,
} from './utils/filesystem/match-finder.utils.js';
import {
	parseEditBySearchParams,
	parseEditByLineParams,
	executeBatchOperation,
} from './utils/filesystem/batch-operations.utils.js';
import {tryFixPath} from './utils/filesystem/path-fixer.utils.js';
import {readOfficeDocument} from './utils/filesystem/office-parser.utils.js';
// ACE Code Search utilities for symbol parsing
import {parseFileSymbols} from './utils/aceCodeSearch/symbol.utils.js';
import type {CodeSymbol} from './types/aceCodeSearch.types.js';
// Notebook utilities for automatic note retrieval
import {queryNotebook} from '../utils/core/notebookManager.js';

const {resolve, dirname, isAbsolute, extname} = path;

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
	 * Check if a file is an image based on extension
	 * @param filePath - Path to the file
	 * @returns True if the file is an image
	 */
	private isImageFile(filePath: string): boolean {
		const ext = extname(filePath).toLowerCase();
		return ext in IMAGE_MIME_TYPES;
	}

	/**
	 * Check if a file is an Office document based on extension
	 * @param filePath - Path to the file
	 * @returns True if the file is an Office document
	 */
	private isOfficeFile(filePath: string): boolean {
		const ext = extname(filePath).toLowerCase();
		return ext in OFFICE_FILE_TYPES;
	}

	/**
	 * Get MIME type for an image file
	 * @param filePath - Path to the file
	 * @returns MIME type or undefined if not an image
	 */
	private getImageMimeType(filePath: string): string | undefined {
		const ext = extname(filePath).toLowerCase();
		return IMAGE_MIME_TYPES[ext as keyof typeof IMAGE_MIME_TYPES];
	}

	/**
	 * Read image file and convert to base64
	 * For SVG files, converts to PNG format for better compatibility
	 * @param fullPath - Full path to the image file
	 * @returns ImageContent object with base64 data
	 */
	private async readImageAsBase64(
		fullPath: string,
	): Promise<ImageContent | null> {
		try {
			const mimeType = this.getImageMimeType(fullPath);
			if (!mimeType) {
				return null;
			}

			const ext = extname(fullPath).toLowerCase();

			// Handle SVG files - convert to PNG for better compatibility
			if (ext === '.svg') {
				try {
					// Try to dynamically import sharp (optional dependency)
					const sharp = (await import('sharp')).default;
					const buffer = await fs.readFile(fullPath);
					// Convert SVG to PNG using sharp
					const pngBuffer = await sharp(buffer).png().toBuffer();
					const base64Data = pngBuffer.toString('base64');

					return {
						type: 'image',
						data: base64Data,
						mimeType: 'image/png', // Return as PNG
					};
				} catch (svgError) {
					// Fallback: If sharp is not available or conversion fails, return SVG as base64
					// Most AI models support SVG directly
					const buffer = await fs.readFile(fullPath);
					const base64Data = buffer.toString('base64');
					return {
						type: 'image',
						data: base64Data,
						mimeType: 'image/svg+xml',
					};
				}
			}
			const buffer = await fs.readFile(fullPath);
			const base64Data = buffer.toString('base64');

			return {
				type: 'image',
				data: base64Data,
				mimeType,
			};
		} catch (error) {
			console.error(`Failed to read image ${fullPath}:`, error);
			return null;
		}
	}

	/**
	 * Extract relevant symbol information for a specific line range
	 * This provides context that helps AI make more accurate modifications
	 * @param symbols - All symbols in the file
	 * @param startLine - Start line of the range
	 * @param endLine - End line of the range
	 * @param _totalLines - Total lines in the file (reserved for future use)
	 * @returns Formatted string with relevant symbol information
	 */
	private extractRelevantSymbols(
		symbols: CodeSymbol[],
		startLine: number,
		endLine: number,
		_totalLines: number,
	): string {
		if (symbols.length === 0) {
			return '';
		}

		// Categorize symbols
		const imports = symbols.filter(s => s.type === 'import');
		const exports = symbols.filter(s => s.type === 'export');

		// Symbols within the requested range
		const symbolsInRange = symbols.filter(
			s => s.line >= startLine && s.line <= endLine,
		);

		// Symbols defined before the range that might be referenced
		const symbolsBeforeRange = symbols.filter(s => s.line < startLine);

		// Build context information
		const parts: string[] = [];

		// Always include imports (crucial for understanding dependencies)
		if (imports.length > 0) {
			const importList = imports
				.slice(0, 10) // Limit to avoid excessive tokens
				.map(s => `  • ${s.name} (line ${s.line})`)
				.join('\n');
			parts.push(`📦 Imports:\n${importList}`);
		}

		// Symbols defined in the current range
		if (symbolsInRange.length > 0) {
			const rangeSymbols = symbolsInRange
				.slice(0, 15)
				.map(
					s =>
						`  • ${s.type}: ${s.name} (line ${s.line})${
							s.signature ? ` - ${s.signature.slice(0, 60)}` : ''
						}`,
				)
				.join('\n');
			parts.push(`🎯 Symbols in this range:\n${rangeSymbols}`);
		}

		// Key definitions before this range (that might be referenced)
		if (symbolsBeforeRange.length > 0 && startLine > 1) {
			const relevantBefore = symbolsBeforeRange
				.filter(s => s.type === 'function' || s.type === 'class')
				.slice(-5) // Last 5 before the range
				.map(s => `  • ${s.type}: ${s.name} (line ${s.line})`)
				.join('\n');
			if (relevantBefore) {
				parts.push(`⬆️ Key definitions above:\n${relevantBefore}`);
			}
		}

		// Exports (important for understanding module interface)
		if (exports.length > 0) {
			const exportList = exports
				.slice(0, 10)
				.map(s => `  • ${s.name} (line ${s.line})`)
				.join('\n');
			parts.push(`📤 Exports:\n${exportList}`);
		}

		if (parts.length === 0) {
			return '';
		}

		return (
			'\n\n' +
			'='.repeat(60) +
			'\n📚 SYMBOL INDEX & DEFINITIONS:\n' +
			'='.repeat(60) +
			'\n' +
			parts.join('\n\n')
		);
	}

	/**
	 * Get notebook entries for a file
	 * @param filePath - Path to the file
	 * @returns Formatted notebook entries string, or empty if none found
	 */
	private getNotebookEntries(filePath: string): string {
		try {
			const entries = queryNotebook(filePath, 10);
			if (entries.length === 0) {
				return '';
			}

			const notesText = entries
				.map((entry, index) => {
					// createdAt 已经是本地时间格式: "YYYY-MM-DDTHH:mm:ss.SSS"
					// 提取日期和时间部分: "YYYY-MM-DD HH:mm"
					const dateStr = entry.createdAt.substring(0, 16).replace('T', ' ');
					return `  ${index + 1}. [${dateStr}] ${entry.note}`;
				})
				.join('\n');

			return (
				'\n\n' +
				'='.repeat(60) +
				'\n📝 CODE NOTEBOOKS (Latest 10):\n' +
				'='.repeat(60) +
				'\n' +
				notesText
			);
		} catch {
			// Silently fail notebook retrieval - don't block file reading
			return '';
		}
	}

	/**
	 * Get the content of a file with optional line range
	 * Enhanced with symbol information for better AI context
	 * Supports multimodal content (text + images)
	 * @param filePath - Path to the file (relative to base path or absolute) or array of file paths or array of file config objects
	 * @param startLine - Starting line number (1-indexed, inclusive, optional - defaults to 1). Used for single file or as default for array of strings
	 * @param endLine - Ending line number (1-indexed, inclusive, optional - defaults to file end). Used for single file or as default for array of strings
	 * @returns Object containing the requested content with line numbers and metadata (supports multimodal content)
	 * @throws Error if file doesn't exist or cannot be read
	 */
	async getFileContent(
		filePath:
			| string
			| string[]
			| Array<{path: string; startLine?: number; endLine?: number}>,
		startLine?: number,
		endLine?: number,
	): Promise<SingleFileReadResult | MultipleFilesReadResult> {
		try {
			// Handle array of files
			if (Array.isArray(filePath)) {
				const filesData: Array<{
					path: string;
					startLine?: number;
					endLine?: number;
					totalLines?: number;
					isImage?: boolean;
					isDocument?: boolean;
					fileType?: 'pdf' | 'word' | 'excel' | 'powerpoint';
					mimeType?: string;
				}> = [];
				const multimodalContent: MultimodalContent = [];

				for (const fileItem of filePath) {
					try {
						// Support both string format and object format
						let file: string;
						let fileStartLine: number | undefined;
						let fileEndLine: number | undefined;

						if (typeof fileItem === 'string') {
							// String format: use global startLine/endLine
							file = fileItem;
							fileStartLine = startLine;
							fileEndLine = endLine;
						} else {
							// Object format: use per-file startLine/endLine
							file = fileItem.path;
							fileStartLine = fileItem.startLine ?? startLine;
							fileEndLine = fileItem.endLine ?? endLine;
						}

						const fullPath = this.resolvePath(file);

						// For absolute paths, skip validation to allow access outside base path
						if (!isAbsolute(file)) {
							await this.validatePath(fullPath);
						}

						// Check if the path is a directory, if so, list its contents instead
						const stats = await fs.stat(fullPath);
						if (stats.isDirectory()) {
							const dirFiles = await this.listFiles(file);
							const fileList = dirFiles.join('\n');
							multimodalContent.push({
								type: 'text',
								text: `📁 Directory: ${file}\n${fileList}`,
							});
							filesData.push({
								path: file,
								startLine: 1,
								endLine: dirFiles.length,
								totalLines: dirFiles.length,
							});
							continue;
						}

						// Check if this is an image file
						if (this.isImageFile(fullPath)) {
							const imageContent = await this.readImageAsBase64(fullPath);
							if (imageContent) {
								// Add text description first
								multimodalContent.push({
									type: 'text',
									text: `🖼️  Image: ${file} (${imageContent.mimeType})`,
								});
								// Add image content
								multimodalContent.push(imageContent);

								filesData.push({
									path: file,
									isImage: true,
									mimeType: imageContent.mimeType,
								});
								continue;
							}
						}

						// Check if this is an Office document file
						if (this.isOfficeFile(fullPath)) {
							const docContent = await readOfficeDocument(fullPath);
							if (docContent) {
								// Add text description first
								multimodalContent.push({
									type: 'text',
									text: `📄 ${docContent.fileType.toUpperCase()} Document: ${file}`,
								});
								// Add document content
								multimodalContent.push(docContent);

								filesData.push({
									path: file,
									isDocument: true,
									fileType: docContent.fileType,
								});
								continue;
							}
						}

						const content = await fs.readFile(fullPath, 'utf-8');
						const lines = content.split('\n');
						const totalLines = lines.length;

						// Default values and logic (use file-specific values)
						const actualStartLine = fileStartLine ?? 1;
						const actualEndLine = fileEndLine ?? totalLines;

						// Validate and adjust line numbers
						if (actualStartLine < 1) {
							throw new Error(`Start line must be greater than 0 for ${file}`);
						}
						if (actualEndLine < actualStartLine) {
							throw new Error(
								`End line must be greater than or equal to start line for ${file}`,
							);
						}
						// Auto-adjust if startLine exceeds file length
						const start = Math.min(actualStartLine, totalLines);
						const end = Math.min(totalLines, actualEndLine);

						// Extract specified lines
						const selectedLines = lines.slice(start - 1, end);
						const numberedLines = selectedLines.map((line, index) => {
							const lineNum = start + index;
							return `${lineNum}→${line}`;
						});

						let fileContent = `📄 ${file} (lines ${start}-${end}/${totalLines})\n${numberedLines.join(
							'\n',
						)}`;

						// Parse and append symbol information
						try {
							const symbols = await parseFileSymbols(
								fullPath,
								content,
								this.basePath,
							);
							const symbolInfo = this.extractRelevantSymbols(
								symbols,
								start,
								end,
								totalLines,
							);
							if (symbolInfo) {
								fileContent += symbolInfo;
							}
						} catch {
							// Silently fail symbol parsing
						}

						// Append notebook entries
						const notebookInfo = this.getNotebookEntries(file);
						if (notebookInfo) {
							fileContent += notebookInfo;
						}

						multimodalContent.push({
							type: 'text',
							text: fileContent,
						});

						filesData.push({
							path: file,
							startLine: start,
							endLine: end,
							totalLines,
						});
					} catch (error) {
						const errorMsg =
							error instanceof Error ? error.message : 'Unknown error';
						// Extract file path for error message
						const filePath =
							typeof fileItem === 'string' ? fileItem : fileItem.path;
						multimodalContent.push({
							type: 'text',
							text: `❌ ${filePath}: ${errorMsg}`,
						});
					}
				}

				return {
					content: multimodalContent,
					files: filesData,
					totalFiles: filePath.length,
				};
			}

			// Original single file logic
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

			// Check if this is an image file
			if (this.isImageFile(fullPath)) {
				const imageContent = await this.readImageAsBase64(fullPath);
				if (imageContent) {
					return {
						content: [
							{
								type: 'text',
								text: `🖼️  Image: ${filePath} (${imageContent.mimeType})`,
							},
							imageContent,
						],
						isImage: true,
						mimeType: imageContent.mimeType,
					};
				}
			}

			// Check if this is an Office document file
			if (this.isOfficeFile(fullPath)) {
				const docContent = await readOfficeDocument(fullPath);
				if (docContent) {
					return {
						content: [
							{
								type: 'text',
								text: `📄 ${docContent.fileType.toUpperCase()} Document: ${filePath}`,
							},
							docContent,
						],
						isDocument: true,
						fileType: docContent.fileType,
					};
				}
			}

			// Text file processing
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
			// Auto-adjust if startLine exceeds file length
			const start = Math.min(actualStartLine, totalLines);
			const end = Math.min(totalLines, actualEndLine);

			// Extract specified lines (convert to 0-indexed) and add line numbers
			const selectedLines = lines.slice(start - 1, end);

			// Format with line numbers (no padding to save tokens)
			const numberedLines = selectedLines.map((line, index) => {
				const lineNum = start + index;
				return `${lineNum}→${line}`;
			});

			let partialContent = numberedLines.join('\n');

			// Parse and append symbol information to provide better context for AI
			try {
				const symbols = await parseFileSymbols(
					fullPath,
					content,
					this.basePath,
				);
				const symbolInfo = this.extractRelevantSymbols(
					symbols,
					start,
					end,
					totalLines,
				);
				if (symbolInfo) {
					partialContent += symbolInfo;
				}
			} catch (error) {
				// Silently fail symbol parsing - don't block file reading
				// This is optional context enhancement, not critical
			}

			// Append notebook entries
			const notebookInfo = this.getNotebookEntries(filePath);
			if (notebookInfo) {
				partialContent += notebookInfo;
			}

			return {
				content: partialContent,
				startLine: start,
				endLine: end,
				totalLines,
			};
		} catch (error) {
			// Try to fix common path issues if it's a file not found error
			if (
				error instanceof Error &&
				error.message.includes('ENOENT') &&
				typeof filePath === 'string'
			) {
				const fixedPath = await tryFixPath(filePath, this.basePath);
				if (fixedPath && fixedPath !== filePath) {
					// Verify the fixed path actually exists before suggesting
					const fixedFullPath = this.resolvePath(fixedPath);
					try {
						await fs.access(fixedFullPath);
						// File exists, provide helpful suggestion to AI
						throw new Error(
							`Failed to read file ${filePath}: ${
								error instanceof Error ? error.message : 'Unknown error'
							}\n💡 Tip: File not found. Did you mean "${fixedPath}"? Please use the correct path.`,
						);
					} catch {
						// Fixed path also doesn't work, just throw original error
					}
				}
			}

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
	 * List files in a directory (internal use for read tool)
	 * @param dirPath - Directory path relative to base path or absolute path
	 * @returns Array of file names
	 * @throws Error if directory cannot be read
	 * @private
	 */
	private async listFiles(dirPath: string = '.'): Promise<string[]> {
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
	 * Edit file(s) by searching for exact content and replacing it
	 * This method uses SMART MATCHING to handle whitespace differences automatically.
	 *
	 * @param filePath - Path to the file to edit, or array of file paths, or array of edit config objects
	 * @param searchContent - Content to search for (for single file or unified mode)
	 * @param replaceContent - New content to replace (for single file or unified mode)
	 * @param occurrence - Which occurrence to replace (1-indexed, default: 1, use -1 for all)
	 * @param contextLines - Number of context lines to return before and after the edit (default: 8)
	 * @returns Object containing success message, before/after comparison, and diagnostics from IDE (VSCode or JetBrains)
	 * @throws Error if search content is not found or multiple matches exist
	 */
	async editFileBySearch(
		filePath: string | string[] | EditBySearchConfig[],
		searchContent?: string,
		replaceContent?: string,
		occurrence: number = 1,
		contextLines: number = 8,
	): Promise<EditBySearchResult> {
		// Handle array of files
		if (Array.isArray(filePath)) {
			return await executeBatchOperation<
				EditBySearchConfig,
				EditBySearchSingleResult,
				EditBySearchBatchResultItem
			>(
				filePath,
				fileItem =>
					parseEditBySearchParams(
						fileItem,
						searchContent,
						replaceContent,
						occurrence,
					),
				(path, search, replace, occ) =>
					this.editFileBySearchSingle(path, search, replace, occ, contextLines),
				(path, result) => {
					return {path, ...result};
				},
			);
		}

		// Single file mode
		if (
			searchContent === undefined ||
			searchContent === null ||
			replaceContent === undefined ||
			replaceContent === null
		) {
			throw new Error(
				'searchContent and replaceContent are required for single file mode',
			);
		}

		return await this.editFileBySearchSingle(
			filePath,
			searchContent,
			replaceContent,
			occurrence,
			contextLines,
		);
	}

	/**
	 * Internal method: Edit a single file by search-replace
	 * @private
	 */
	private async editFileBySearchSingle(
		filePath: string,
		searchContent: string,
		replaceContent: string,
		occurrence: number,
		contextLines: number,
	): Promise<EditBySearchSingleResult> {
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
			// Original threshold - using async similarity for precision without UI freeze
			const threshold = 0.6;

			// Fast pre-filter: use first line as anchor to skip unlikely positions
			// Only apply pre-filter for multi-line searches to avoid missing valid matches
			const searchFirstLine =
				searchLines[0]?.replace(/\\s+/g, ' ').trim() || '';
			const usePreFilter = searchLines.length >= 5; // Only pre-filter for 5+ line searches
			const preFilterThreshold = 0.2;
			const maxMatches = 10; // Limit matches to avoid excessive computation

			// Async similarity calculations yield to event loop automatically
			for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
				// Quick pre-filter: check first line similarity (only for multi-line searches)
				// Keep this synchronous as it's very fast
				if (usePreFilter) {
					const firstLineCandidate =
						contentLines[i]?.replace(/\s+/g, ' ').trim() || '';
					const firstLineSimilarity = calculateSimilarity(
						searchFirstLine,
						firstLineCandidate,
						preFilterThreshold,
					);

					// Skip only if first line is very different (< 20% match)
					// This is safe because if first line differs this much, full match unlikely
					if (firstLineSimilarity < preFilterThreshold) {
						continue;
					}
				}

				// Full candidate check - use async to prevent UI freeze
				// The async similarity calculation yields to event loop, preventing UI freeze
				const candidateLines = contentLines.slice(i, i + searchLines.length);
				const candidateContent = candidateLines.join('\n');
				const similarity = await calculateSimilarityAsync(
					normalizedSearch,
					candidateContent,
					threshold, // Pass threshold for early exit consideration
				);

				// Accept matches above threshold
				if (similarity >= threshold) {
					matches.push({
						startLine: i + 1,
						endLine: i + searchLines.length,
						similarity,
					});

					// Early exit if we found a nearly perfect match
					if (similarity >= 0.95) {
						break;
					}

					// Limit matches to avoid excessive computation
					if (matches.length >= maxMatches) {
						break;
					}
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
					// Unescape succeeded! Re-run the matching with corrected content using async
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
						// Use async similarity to prevent UI freeze during unescape correction
						const similarity = await calculateSimilarityAsync(
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
					const closestMatches = await findClosestMatches(
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
						errorMessage += `  • Make sure you copied content from filesystem-read (without "123→")\n`;
						errorMessage += `  • Whitespace differences are automatically handled\n`;
						errorMessage += `  • Try copying a larger or smaller code block\n`;
						errorMessage += `  • If multiple filesystem-edit_search attempts fail, use terminal-execute to edit via command line (e.g. sed, printf)\n`;

						errorMessage += `⚠️  No similar content found in the file.\n\n`;
						errorMessage += `📝 What you searched for (first 5 lines, formatted):\n`;

						searchLines.slice(0, 5).forEach((line, idx) => {
							errorMessage += `${idx + 1}. ${JSON.stringify(
								normalizeForDisplay(line),
							)}\n`;
						});
						errorMessage += `\n💡 Copy exact content from filesystem-read (without line numbers)\n`;
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

			const replacedLines = lines.slice(startLine - 1, endLine);
			const replacedContent = replacedLines
				.map((line, idx) => {
					const lineNum = startLine + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
				})
				.join('\n');

			// Calculate context boundaries
			const lineDifference = replaceLines.length - (endLine - startLine + 1);

			const smartBoundaries = findSmartContextBoundaries(
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
					// Use Prettier API for better performance (avoids npx overhead)
					const prettierConfig = await prettier.resolveConfig(fullPath);
					finalContent = await prettier.format(modifiedContent, {
						filepath: fullPath,
						...prettierConfig,
					});

					// Write formatted content back to file
					await fs.writeFile(fullPath, finalContent, 'utf-8');
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
			const structureAnalysis = analyzeCodeStructure(
				finalContent,
				filePath,
				editedContentLines,
			);

			// Get diagnostics from IDE (VSCode or JetBrains) - non-blocking, fire-and-forget
			let diagnostics: Diagnostic[] = [];
			try {
				// Request diagnostics without blocking (with timeout protection)
				const diagnosticsPromise = Promise.race([
					vscodeConnection.requestDiagnostics(fullPath),
					new Promise<Diagnostic[]>(resolve =>
						setTimeout(() => resolve([]), 1000),
					), // 1s max wait
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
						(w: string) => `Indentation: ${w}`,
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
	 * Edit file(s) by replacing lines within a specified range
	 * BEST PRACTICE: Keep edits small and focused (≤15 lines recommended) for better accuracy.
	 * For larger changes, make multiple parallel edits to non-overlapping sections instead of one large edit.
	 *
	 * @param filePath - Path to the file to edit, or array of file paths, or array of edit config objects
	 * @param startLine - Starting line number (for single file or unified mode)
	 * @param endLine - Ending line number (for single file or unified mode)
	 * @param newContent - New content to replace (for single file or unified mode)
	 * @param contextLines - Number of context lines to return before and after the edit (default: 8)
	 * @returns Object containing success message, precise before/after comparison, and diagnostics from IDE (VSCode or JetBrains)
	 * @throws Error if file editing fails
	 */
	async editFile(
		filePath: string | string[] | EditByLineConfig[],
		startLine?: number,
		endLine?: number,
		newContent?: string,
		contextLines: number = 8,
	): Promise<EditByLineResult> {
		// Handle array of files
		if (Array.isArray(filePath)) {
			return await executeBatchOperation<
				EditByLineConfig,
				EditByLineSingleResult,
				EditByLineBatchResultItem
			>(
				filePath,
				fileItem =>
					parseEditByLineParams(fileItem, startLine, endLine, newContent),
				(path, start, end, content) =>
					this.editFileSingle(path, start, end, content, contextLines),
				(path, result) => {
					return {path, ...result};
				},
			);
		}

		// Single file mode
		if (
			startLine === undefined ||
			endLine === undefined ||
			newContent === undefined
		) {
			throw new Error(
				'startLine, endLine, and newContent are required for single file mode',
			);
		}

		return await this.editFileSingle(
			filePath,
			startLine,
			endLine,
			newContent,
			contextLines,
		);
	}

	/**
	 * Internal method: Edit a single file by line range
	 * @private
	 */
	private async editFileSingle(
		filePath: string,
		startLine: number,
		endLine: number,
		newContent: string,
		contextLines: number,
	): Promise<EditByLineSingleResult> {
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

			// Adjust startLine and endLine if they exceed file length
			const adjustedStartLine = Math.min(startLine, totalLines);
			const adjustedEndLine = Math.min(endLine, totalLines);
			const linesToModify = adjustedEndLine - adjustedStartLine + 1;

			// Backup file before editing
			await incrementalSnapshotManager.backupFile(fullPath);

			// Extract the lines that will be replaced (for comparison)
			// Compress whitespace for display readability

			const replacedLines = lines.slice(adjustedStartLine - 1, adjustedEndLine);
			const replacedContent = replacedLines
				.map((line, idx) => {
					const lineNum = adjustedStartLine + idx;
					return `${lineNum}→${normalizeForDisplay(line)}`;
				})
				.join('\n');

			// Calculate context range using smart boundary detection
			const smartBoundaries = findSmartContextBoundaries(
				lines,
				adjustedStartLine,
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
			const beforeLines = lines.slice(0, adjustedStartLine - 1);
			const afterLines = lines.slice(adjustedEndLine);
			const modifiedLines = [...beforeLines, ...newContentLines, ...afterLines];

			// Calculate new context range
			const newTotalLines = modifiedLines.length;
			const lineDifference =
				newContentLines.length - (adjustedEndLine - adjustedStartLine + 1);
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
					// Use Prettier API for better performance (avoids npx overhead)
					const prettierConfig = await prettier.resolveConfig(fullPath);
					const newContent = modifiedLines.join('\n');
					const formattedContent = await prettier.format(newContent, {
						filepath: fullPath,
						...prettierConfig,
					});

					// Write formatted content back to file
					await fs.writeFile(fullPath, formattedContent, 'utf-8');
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
				adjustedStartLine - 1,
				adjustedStartLine - 1 + newContentLines.length,
			);
			const structureAnalysis = analyzeCodeStructure(
				finalLines.join('\n'),
				filePath,
				editedContentLines,
			);

			// Try to get diagnostics from IDE (VSCode or JetBrains) after editing (non-blocking)
			let diagnostics: Diagnostic[] = [];
			try {
				// Request diagnostics without blocking (with timeout protection)
				const diagnosticsPromise = Promise.race([
					vscodeConnection.requestDiagnostics(fullPath),
					new Promise<Diagnostic[]>(resolve =>
						setTimeout(() => resolve([]), 1000),
					), // 1s max wait
				]);
				diagnostics = await diagnosticsPromise;
			} catch (error) {
				// Ignore diagnostics errors - they are optional
			}

			const result: EditByLineSingleResult = {
				message:
					`✅ File edited successfully,Please check the edit results and pay attention to code boundary issues to avoid syntax errors caused by missing closed parts: ${filePath}\n` +
					`   Replaced: lines ${adjustedStartLine}-${adjustedEndLine} (${linesToModify} lines)\n` +
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
						(w: string) => `Indentation: ${w}`,
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
		name: 'filesystem-read',
		description:
			'Read file content with line numbers and multimodal support (text + images + Office documents). **MULTIMODAL SUPPORT**: Automatically detects and processes: (1) Image files (.png, .jpg, .jpeg, .gif, .webp, .bmp, .svg) - returns base64-encoded image data, (2) Office documents (.pdf, .docx, .doc, .xlsx, .xls, .pptx, .ppt) - extracts and returns readable text content. All returned in MCP content format for AI analysis. **Read only when the actual file or folder path is found or provided by the user, do not make random guesses,Search for specific documents or line numbers before reading more accurately** **SUPPORTS MULTIPLE FILES WITH FLEXIBLE LINE RANGES**: Pass either (1) a single file path (string), (2) array of file paths (strings) with unified startLine/endLine, or (3) array of file config objects with per-file line ranges. **INTEGRATED DIRECTORY LISTING**: When filePath is a directory, automatically lists its contents instead of throwing error. ⚠️ **IMPORTANT WORKFLOW**: (1) ALWAYS use ACE search tools FIRST (ace-text_search/ace-search_symbols/ace-file_outline) to locate the relevant code, (2) ONLY use filesystem-read when you know the approximate location and need precise line numbers for editing. **ANTI-PATTERN**: Reading files line-by-line from the top wastes tokens - use search instead! **USAGE**: Call without parameters to read entire file(s), or specify startLine/endLine for partial reads. Returns content with line numbers (format: "123→code") for text files or multimodal content array for images/documents. **EXAMPLES**: (A) Unified: filePath=["a.ts", "b.ts"], startLine=1, endLine=500 reads lines 1-500 from both. (B) Per-file: filePath=[{path:"a.ts", startLine:1, endLine:300}, {path:"b.ts", startLine:100, endLine:550}] reads different ranges from each file. (C) Directory: filePath="./src" returns list of files in src/. (D) Image: filePath="screenshot.png" returns multimodal content with base64 image data. (E) Office: filePath="report.pdf" or "data.xlsx" extracts and returns document text.',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					oneOf: [
						{
							type: 'string',
							description: 'Path to a single file to read or directory to list',
						},
						{
							type: 'array',
							items: {
								type: 'string',
							},
							description:
								'Array of file paths to read in one call (uses unified startLine/endLine from top-level parameters)',
						},
						{
							type: 'array',
							items: {
								type: 'object',
								properties: {
									path: {
										type: 'string',
										description: 'File path',
									},
									startLine: {
										type: 'number',
										description:
											'Optional: Starting line for this file (overrides top-level startLine)',
									},
									endLine: {
										type: 'number',
										description:
											'Optional: Ending line for this file (overrides top-level endLine)',
									},
								},
								required: ['path'],
							},
							description:
								'Array of file config objects with per-file line ranges. Each file can have its own startLine/endLine.',
						},
					],
					description:
						'Path to the file(s) to read or directory to list: string, array of strings, or array of {path, startLine?, endLine?} objects',
				},
				startLine: {
					type: 'number',
					description:
						'Optional: Default starting line number (1-indexed) for all files. Omit to read from line 1. Can be overridden by per-file startLine in object format.',
				},
				endLine: {
					type: 'number',
					description:
						'Optional: Default ending line number (1-indexed) for all files. Omit to read to end of file. Can be overridden by per-file endLine in object format.',
				},
			},
			required: ['filePath'],
		},
	},
	{
		name: 'filesystem-create',
		description:
			'Preferred tool for creating files: Use specified content to create a new file. Before creating the file, you need to determine if the file already exists; if it does, your creation will fail. You should use editing instead of creation, as this tool is more reliable than terminal commands like echo/cat with redirection. If necessary, automatically create the parent directory. If necessary, terminal commands can be used as a fallback.',
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
		name: 'filesystem-edit_search',
		description:
			'RECOMMENDED for most edits: Search-and-replace with SMART FUZZY MATCHING. SUPPORTS BATCH EDITING: Pass (1) single file with search/replace, (2) array of file paths with unified search/replace, or (3) array of {path, searchContent, replaceContent, occurrence?} for per-file edits. CRITICAL WORKFLOW FOR CODE SAFETY: (1) Use ace-text_search/ace-search_symbols to locate code, (2) MUST use filesystem-read to identify COMPLETE code boundaries (entire function body with all braces, complete markup tags with opening/closing pairs, full code blocks), (3) Copy the COMPLETE code block (without line numbers), (4) Verify boundaries are intact (matching braces/brackets/tags), (5) Use THIS tool. WHY: No line tracking, auto-handles spacing/tabs, finds best match. COMMON ERRORS TO AVOID: Modifying only part of a function (missing closing brace), incomplete markup tags (HTML/Vue/JSX), partial code blocks. Always include complete syntactic units. BATCH EXAMPLE: filePath=[{path:"a.ts", searchContent:"old1", replaceContent:"new1"}, {path:"b.ts", searchContent:"old2", replaceContent:"new2"}]',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					oneOf: [
						{
							type: 'string',
							description: 'Path to a single file to edit',
						},
						{
							type: 'array',
							items: {
								type: 'string',
							},
							description:
								'Array of file paths (uses unified searchContent/replaceContent from top-level)',
						},
						{
							type: 'array',
							items: {
								type: 'object',
								properties: {
									path: {
										type: 'string',
										description: 'File path',
									},
									searchContent: {
										type: 'string',
										description: 'Content to search for in this file',
									},
									replaceContent: {
										type: 'string',
										description: 'New content to replace with',
									},
									occurrence: {
										type: 'number',
										description:
											'Which match to replace (1-indexed, default: 1)',
									},
								},
								required: ['path', 'searchContent', 'replaceContent'],
							},
							description:
								'Array of edit config objects for per-file search-replace operations',
						},
					],
					description: 'File path(s) to edit',
				},
				searchContent: {
					type: 'string',
					description:
						'Content to find and replace (for single file or unified mode). Copy from filesystem-read WITHOUT line numbers.',
				},
				replaceContent: {
					type: 'string',
					description:
						'New content to replace with (for single file or unified mode)',
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
			required: ['filePath'],
		},
	},
	{
		name: 'filesystem-edit',
		description:
			'Line-based editing for precise control. SUPPORTS BATCH EDITING: Pass (1) single file with line range, (2) array of file paths with unified line range, or (3) array of {path, startLine, endLine, newContent} for per-file edits. WHEN TO USE: (1) Adding new code sections, (2) Deleting specific line ranges, (3) When search-replace not suitable. CRITICAL WORKFLOW FOR CODE SAFETY: (1) Use ace-text_search/ace-file_outline to locate area, (2) MUST use filesystem-read to identify COMPLETE code boundaries - for functions: include opening line to closing brace; for markup tags (HTML/Vue/JSX): include opening tag to closing tag; for code blocks: include all braces/brackets, (3) Verify line range covers the ENTIRE syntactic unit (check indentation levels, matching pairs), (4) Use THIS tool with exact startLine/endLine. RECOMMENDATION: For modifying existing code, use filesystem-edit_search - safer and no line tracking needed. COMMON ERRORS TO AVOID: Line range stops mid-function (missing closing brace), partial markup tags, incomplete code blocks. Always verify boundaries with filesystem-read first. BATCH EXAMPLE: filePath=[{path:"a.ts", startLine:10, endLine:20, newContent:"..."}, {path:"b.ts", startLine:50, endLine:60, newContent:"..."}]',
		inputSchema: {
			type: 'object',
			properties: {
				filePath: {
					oneOf: [
						{
							type: 'string',
							description: 'Path to a single file to edit',
						},
						{
							type: 'array',
							items: {
								type: 'string',
							},
							description:
								'Array of file paths (uses unified startLine/endLine/newContent from top-level)',
						},
						{
							type: 'array',
							items: {
								type: 'object',
								properties: {
									path: {
										type: 'string',
										description: 'File path',
									},
									startLine: {
										type: 'number',
										description: 'Starting line number (1-indexed, inclusive)',
									},
									endLine: {
										type: 'number',
										description: 'Ending line number (1-indexed, inclusive)',
									},
									newContent: {
										type: 'string',
										description:
											'New content to replace lines (without line numbers)',
									},
								},
								required: ['path', 'startLine', 'endLine', 'newContent'],
							},
							description:
								'Array of edit config objects for per-file line-based edits',
						},
					],
					description: 'File path(s) to edit',
				},
				startLine: {
					type: 'number',
					description:
						'⚠️  CRITICAL: Starting line number (1-indexed, inclusive) for single file or unified mode. MUST match filesystem-read output.',
				},
				endLine: {
					type: 'number',
					description:
						'⚠️  CRITICAL: Ending line number (1-indexed, inclusive) for single file or unified mode. Keep edits small (≤15 lines).',
				},
				newContent: {
					type: 'string',
					description:
						'New content to replace specified lines (for single file or unified mode). ⚠️  Do NOT include line numbers. Ensure proper indentation.',
				},
				contextLines: {
					type: 'number',
					description:
						'Number of context lines to show before/after edit for verification (default: 8)',
					default: 8,
				},
			},
			required: ['filePath'],
		},
	},
];
