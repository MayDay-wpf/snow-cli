import {promises as fs} from 'fs';
import * as path from 'path';
import * as prettier from 'prettier';
// IDE connection supports both VSCode and JetBrains IDEs
import {
	vscodeConnection,
	type Diagnostic,
} from '../utils/ui/vscodeConnection.js';
// SSH support for remote file operations
import {SSHClient, parseSSHUrl} from '../utils/ssh/sshClient.js';
import {
	getWorkingDirectories,
	type SSHConfig,
} from '../utils/config/workingDirConfig.js';
// Type definitions
import type {
	EditByHashlineConfig,
	EditByHashlineResult,
	EditByHashlineSingleResult,
	EditByHashlineBatchResultItem,
	EditBySearchConfig,
	EditBySearchResult,
	EditBySearchSingleResult,
	EditBySearchBatchResultItem,
	HashlineOperation,
	SingleFileReadResult,
	MultipleFilesReadResult,
	MultimodalContent,
	ImageContent,
} from './types/filesystem.types.js';
import {IMAGE_MIME_TYPES, OFFICE_FILE_TYPES} from './types/filesystem.types.js';
import {
	tryUnescapeFix,
	trimPairIfPossible,
	isOverEscaped,
} from '../utils/ui/escapeHandler.js';
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
	executeBatchOperation,
} from './utils/filesystem/batch-operations.utils.js';
import {tryFixPath} from './utils/filesystem/path-fixer.utils.js';
import {readOfficeDocument} from './utils/filesystem/office-parser.utils.js';
// ACE Code Search utilities for symbol parsing
import {parseFileSymbols} from './utils/aceCodeSearch/symbol.utils.js';
import type {CodeSymbol} from './types/aceCodeSearch.types.js';
// Notebook utilities for automatic note retrieval
import {queryNotebook} from '../utils/core/notebookManager.js';
// Encoding detection and conversion utilities
import {
	readFileWithEncoding,
	readFileLinesStreaming,
	writeFileWithEncoding,
} from './utils/filesystem/encoding.utils.js';
import {getAutoFormatEnabled} from '../utils/config/projectSettings.js';
import {
	formatLineWithHash,
	formatLineWithHashDisplay,
	validateAnchor,
} from './utils/filesystem/hashline.utils.js';

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
	 * Check if a path is a remote SSH URL
	 * @param filePath - Path to check
	 * @returns True if the path is an SSH URL
	 */
	private isSSHPath(filePath: string): boolean {
		return filePath.startsWith('ssh://');
	}

	/**
	 * Get SSH config for a remote path from working directories
	 * @param sshUrl - SSH URL to find config for
	 * @returns SSH config if found, null otherwise
	 */
	private async getSSHConfigForPath(sshUrl: string): Promise<SSHConfig | null> {
		const workingDirs = await getWorkingDirectories();
		for (const dir of workingDirs) {
			if (dir.isRemote && dir.sshConfig && sshUrl.startsWith(dir.path)) {
				return dir.sshConfig;
			}
		}
		// Try to match by host/user
		const parsed = parseSSHUrl(sshUrl);
		if (parsed) {
			for (const dir of workingDirs) {
				if (dir.isRemote && dir.sshConfig) {
					const dirParsed = parseSSHUrl(dir.path);
					if (
						dirParsed &&
						dirParsed.host === parsed.host &&
						dirParsed.username === parsed.username &&
						dirParsed.port === parsed.port
					) {
						return dir.sshConfig;
					}
				}
			}
		}
		return null;
	}

	/**
	 * Read file content from remote SSH server
	 * @param sshUrl - SSH URL of the file
	 * @returns File content as string
	 */
	private async readRemoteFile(sshUrl: string): Promise<string> {
		const parsed = parseSSHUrl(sshUrl);
		if (!parsed) {
			throw new Error(`Invalid SSH URL: ${sshUrl}`);
		}

		const sshConfig = await this.getSSHConfigForPath(sshUrl);
		if (!sshConfig) {
			throw new Error(`No SSH configuration found for: ${sshUrl}`);
		}

		const client = new SSHClient();
		const connectResult = await client.connect(sshConfig);
		if (!connectResult.success) {
			throw new Error(`SSH connection failed: ${connectResult.error}`);
		}

		try {
			const content = await client.readFile(parsed.path);
			return content;
		} finally {
			client.disconnect();
		}
	}

	/**
	 * Write file content to remote SSH server
	 * @param sshUrl - SSH URL of the file
	 * @param content - Content to write
	 */
	private async writeRemoteFile(
		sshUrl: string,
		content: string,
	): Promise<void> {
		const parsed = parseSSHUrl(sshUrl);
		if (!parsed) {
			throw new Error(`Invalid SSH URL: ${sshUrl}`);
		}

		const sshConfig = await this.getSSHConfigForPath(sshUrl);
		if (!sshConfig) {
			throw new Error(`No SSH configuration found for: ${sshUrl}`);
		}

		const client = new SSHClient();
		const connectResult = await client.connect(sshConfig);
		if (!connectResult.success) {
			throw new Error(`SSH connection failed: ${connectResult.error}`);
		}

		try {
			await client.writeFile(parsed.path, content);
		} finally {
			client.disconnect();
		}
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
			// Defensive handling: if filePath is a string that looks like a JSON array, parse it
			// This can happen when AI tools serialize array parameters as strings
			if (
				typeof filePath === 'string' &&
				filePath.startsWith('[') &&
				filePath.endsWith(']')
			) {
				try {
					const parsed = JSON.parse(filePath);
					if (Array.isArray(parsed)) {
						filePath = parsed;
					}
				} catch {
					// If parsing fails, treat as a regular string path
				}
			}

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

				// Track the last successfully resolved absolute path for context-aware relative path resolution
				let lastAbsolutePath: string | undefined;

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

						// Use context-aware path resolution for relative paths in batch operations
						const fullPath = this.resolvePath(file, lastAbsolutePath);

						// Update lastAbsolutePath for next iteration if this path is absolute
						if (isAbsolute(file)) {
							lastAbsolutePath = fullPath;
						}

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

						const fileSizeBytes = stats.size;
						const FILE_SIZE_LIMIT = 256 * 1024 * 1024;
						let content: string | undefined;
						let lines: string[];
						let totalLines: number;

						if (fileSizeBytes > FILE_SIZE_LIMIT) {
							const actualStart = fileStartLine ?? 1;
							const actualEnd = fileEndLine ?? 500;
							if (actualStart < 1) {
								throw new Error(
									`Start line must be greater than 0 for ${file}`,
								);
							}
							const streamed = await readFileLinesStreaming(
								fullPath,
								actualStart,
								actualEnd,
							);
							lines = streamed.lines;
							totalLines = streamed.totalLines;
						} else {
							content = await readFileWithEncoding(fullPath);
							lines = content.split('\n');
							totalLines = lines.length;
						}

						// Default values and logic (use file-specific values)
						const actualStartLine = fileStartLine ?? 1;
						const actualEndLine =
							fileSizeBytes > FILE_SIZE_LIMIT
								? fileEndLine ?? 500
								: fileEndLine ?? totalLines;

						// Validate and adjust line numbers
						if (actualStartLine < 1) {
							throw new Error(`Start line must be greater than 0 for ${file}`);
						}
						if (actualEndLine < actualStartLine) {
							throw new Error(
								`End line must be greater than or equal to start line for ${file}`,
							);
						}

						const start = Math.min(actualStartLine, totalLines);
						const end = Math.min(totalLines, actualEndLine);

						// For large files, lines are already the requested slice;
						// for normal files, extract from the full content
						const selectedLines =
							fileSizeBytes > FILE_SIZE_LIMIT
								? lines
								: lines.slice(start - 1, end);
						const numberedLines = selectedLines.map((line, index) => {
							const lineNum = start + index;
							return formatLineWithHash(lineNum, line);
						});

						const sizeWarning =
							fileSizeBytes > FILE_SIZE_LIMIT
								? ` [Large file: ${Math.round(fileSizeBytes / 1024 / 1024)}MB]`
								: '';
						let fileContent = `📄 ${file} (lines ${start}-${end}/${totalLines})${sizeWarning}\n${numberedLines.join(
							'\n',
						)}`;

						// Parse and append symbol information (skip for large files)
						if (content) {
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
						const inputPath =
							typeof fileItem === 'string' ? fileItem : fileItem.path;
						// Try to resolve path for better error context (may fail, so wrapped in try-catch)
						let resolvedPathInfo = '';
						try {
							const attemptedResolve = this.resolvePath(
								inputPath,
								lastAbsolutePath,
							);
							if (attemptedResolve !== inputPath) {
								resolvedPathInfo = `\n   Resolved to: ${attemptedResolve}`;
							}
						} catch {
							// Ignore resolution errors in error handler
						}
						multimodalContent.push({
							type: 'text',
							text: `❌ ${inputPath}${resolvedPathInfo}\n   Error: ${errorMsg}`,
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
			// Check if this is a remote SSH path
			if (this.isSSHPath(filePath)) {
				// Handle remote SSH file
				const content = await this.readRemoteFile(filePath);
				const lines = content.split('\n');
				const totalLines = lines.length;

				const actualStartLine = startLine ?? 1;
				const actualEndLine = endLine ?? totalLines;

				if (actualStartLine < 1) {
					throw new Error('Start line must be greater than 0');
				}
				if (actualEndLine < actualStartLine) {
					throw new Error(
						'End line must be greater than or equal to start line',
					);
				}

				const start = Math.min(actualStartLine, totalLines);
				const end = Math.min(totalLines, actualEndLine);
				const selectedLines = lines.slice(start - 1, end);

				const numberedLines = selectedLines.map((line, index) => {
					const lineNum = start + index;
					return `${lineNum}->${line}`;
				});

				const fileContent = numberedLines.join('\n');

				return {
					content: fileContent,
					startLine: start,
					endLine: end,
					totalLines,
				};
			}

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

			// Text file processing — use streaming for files that exceed the
			// in-memory string limit to avoid ERR_STRING_TOO_LONG crashes
			let content: string | undefined;
			let lines: string[];
			let totalLines: number;

			const fileSizeBytes = stats.size;
			const FILE_SIZE_LIMIT = 256 * 1024 * 1024; // 256MB

			if (fileSizeBytes > FILE_SIZE_LIMIT) {
				const actualStartLine = startLine ?? 1;
				const actualEndLine = endLine ?? 500;

				if (actualStartLine < 1) {
					throw new Error('Start line must be greater than 0');
				}

				const streamed = await readFileLinesStreaming(
					fullPath,
					actualStartLine,
					actualEndLine,
				);
				lines = streamed.lines;
				totalLines = streamed.totalLines;

				const start = Math.min(actualStartLine, totalLines);
				const end = Math.min(
					totalLines,
					Math.min(actualEndLine, start + lines.length - 1),
				);
				const numberedLines = lines.map((line, index) => {
					const lineNum = start + index;
					return formatLineWithHash(lineNum, line);
				});

				const sizeInfo = `[File: ${Math.round(
					fileSizeBytes / 1024 / 1024,
				)}MB, ${totalLines} lines total. Showing lines ${start}-${end}. Use startLine/endLine to read other sections.]`;
				const partialContent = `${sizeInfo}\n${numberedLines.join('\n')}`;

				return {
					content: partialContent,
					startLine: start,
					endLine: end,
					totalLines,
				};
			}

			content = await readFileWithEncoding(fullPath);

			lines = content.split('\n');
			totalLines = lines.length;

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

			// Format with line numbers and content hashes for hashline anchoring
			const numberedLines = selectedLines.map((line, index) => {
				const lineNum = start + index;
				return formatLineWithHash(lineNum, line);
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
	 * @param overwrite - Whether to overwrite the file if it already exists
	 * @returns Success message
	 * @throws Error if file creation fails
	 */
	async createFile(
		filePath: string,
		content: string,
		createDirectories: boolean = true,
		overwrite: boolean = false,
	): Promise<string> {
		try {
			const fullPath = this.resolvePath(filePath);

			let fileExisted = false;
			let originalContent: string | undefined;

			// Check if file already exists
			try {
				await fs.access(fullPath);
				if (!overwrite) {
					throw new Error(`File already exists: ${filePath}`);
				}
				fileExisted = true;
				originalContent = await readFileWithEncoding(fullPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}

			// Backup for rollback
			try {
				const {getConversationContext} = await import(
					'../utils/codebase/conversationContext.js'
				);
				const context = getConversationContext();
				if (context) {
					const {hashBasedSnapshotManager} = await import(
						'../utils/codebase/hashBasedSnapshot.js'
					);
					await hashBasedSnapshotManager.backupFile(
						context.sessionId,
						context.messageIndex,
						filePath,
						this.basePath,
						fileExisted,
						originalContent,
					);
				}
			} catch (backupError) {
				// Don't fail the operation if backup fails
			}

			// Create parent directories if needed
			if (createDirectories) {
				const dir = dirname(fullPath);
				await fs.mkdir(dir, {recursive: true});
			}

			await writeFileWithEncoding(fullPath, content);
			return fileExisted
				? `File overwritten successfully: ${filePath}`
				: `File created successfully: ${filePath}`;
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
	 * Fuzzy search-and-replace editing (exposed as MCP tool `filesystem-replaceedit`).
	 * Copy search text from source files; strip `lineNum:hash→` prefixes if pasting from filesystem-read.
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
			// Check if this is a remote SSH path
			const isRemote = this.isSSHPath(filePath);
			let content: string;
			let fullPath: string;

			if (isRemote) {
				// Handle remote SSH file
				content = await this.readRemoteFile(filePath);
				fullPath = filePath;
			} else {
				fullPath = this.resolvePath(filePath);

				// For absolute paths, skip validation to allow access outside base path
				if (!isAbsolute(filePath)) {
					await this.validatePath(fullPath);
				}

				// Read the entire file
				content = await readFileWithEncoding(fullPath);
			}

			const lines = content.split('\n');

			// Backup for rollback (file modification)
			try {
				const {getConversationContext} = await import(
					'../utils/codebase/conversationContext.js'
				);
				const context = getConversationContext();
				if (context) {
					const {hashBasedSnapshotManager} = await import(
						'../utils/codebase/hashBasedSnapshot.js'
					);
					await hashBasedSnapshotManager.backupFile(
						context.sessionId,
						context.messageIndex,
						filePath,
						this.basePath,
						true, // File existed
						content, // Original content
					);
				}
			} catch (backupError) {
				// Don't fail the operation if backup fails
			}

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
			// Fuzzy match threshold (fixed): stricter = higher value
			const threshold = 0.75;

			// Fast pre-filter: use first line as anchor to skip unlikely positions
			// Only apply pre-filter for multi-line searches to avoid missing valid matches
			const searchFirstLine =
				searchLines[0]?.replace(/\s+/g, ' ').trim() || '';
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
					errorMessage += `🔍 Using smart fuzzy matching (threshold: ${threshold})\n`;
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

			// Perform the replacement by replacing the matched lines
			const normalizedReplace = replaceContent
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n');
			const beforeLines = lines.slice(0, startLine - 1);
			const afterLines = lines.slice(endLine);
			let replaceLines = normalizedReplace.split('\n');

			// Fix indentation for Python/YAML files: preserve first line's original indentation
			// but keep relative indentation for subsequent lines
			if (replaceLines.length > 0) {
				const originalFirstLine = lines[startLine - 1];
				const originalIndent = originalFirstLine?.match(/^(\s*)/)?.[1] || '';
				const replaceFirstLine = replaceLines[0];
				const replaceIndent = replaceFirstLine?.match(/^(\s*)/)?.[1] || '';

				// Only adjust if the first line indentation is different
				if (originalIndent !== replaceIndent && replaceFirstLine) {
					// Adjust only the first line to match original indentation
					const adjustedFirstLine = originalIndent + replaceFirstLine.trim();
					replaceLines[0] = adjustedFirstLine;
					// Subsequent lines keep their relative indentation
				}
			}

			const modifiedLines = [...beforeLines, ...replaceLines, ...afterLines];
			const modifiedContent = modifiedLines.join('\n');

			// Calculate replaced content for display (raw text, no line-number prefix)
			const replacedLines = lines.slice(startLine - 1, endLine);
			const replacedContent = replacedLines.join('\n');

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

			// Extract old content for context (raw text for reliable diff rendering)
			const oldContextLines = lines.slice(contextStart - 1, contextEnd);
			const oldContent = oldContextLines.join('\n');

			// Write the modified content
			if (isRemote) {
				await this.writeRemoteFile(fullPath, modifiedContent);
			} else {
				await writeFileWithEncoding(fullPath, modifiedContent);
			}

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
				getAutoFormatEnabled() &&
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
					if (isRemote) {
						await this.writeRemoteFile(fullPath, finalContent);
					} else {
						await writeFileWithEncoding(fullPath, finalContent);
					}
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

			// Extract new content for context (raw text for reliable diff rendering)
			const newContextLines = finalLines.slice(
				contextStart - 1,
				finalContextEnd,
			);
			const newContextContent = newContextLines.join('\n');

			// Provide a larger overflow window so UI can render a broader diff hunk
			// and help models verify bracket/block closure with surrounding context.
			const overflowPadding = Math.max(3, contextLines);
			const completeOldStart = Math.max(1, contextStart - overflowPadding);
			const completeOldEnd = Math.min(lines.length, contextEnd + overflowPadding);
			const completeOldContent = lines
				.slice(completeOldStart - 1, completeOldEnd)
				.join('\n');

			const finalLineDifference = finalLines.length - lines.length;
			const completeNewStart = Math.max(1, completeOldStart);
			const completeNewEnd = Math.min(
				finalLines.length,
				completeOldEnd + finalLineDifference,
			);
			const completeNewContent = finalLines
				.slice(completeNewStart - 1, completeNewEnd)
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
				filePath, // Include file path for DiffViewer display on Resume/re-render
				oldContent,
				newContent: newContextContent,
				completeOldContent,
				completeNewContent,
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
	 * Edit file(s) using hashline anchors.
	 *
	 * Each operation references lines by `lineNum:hash` anchors obtained from
	 * a previous `filesystem-read`.  Hashes are validated before any mutation
	 * so stale reads are caught early.
	 *
	 * Supported operation types:
	 *   • replace  – replace startAnchor..endAnchor (inclusive) with content
	 *   • insert_after – insert content after startAnchor (endAnchor required; same as startAnchor)
	 *   • delete   – delete startAnchor..endAnchor (inclusive)
	 */
	async editFile(
		filePath: string | EditByHashlineConfig[],
		operations?: HashlineOperation[],
		contextLines: number = 8,
	): Promise<EditByHashlineResult> {
		if (Array.isArray(filePath)) {
			return await executeBatchOperation<
				EditByHashlineConfig,
				EditByHashlineSingleResult,
				EditByHashlineBatchResultItem
			>(
				filePath,
				fileItem => {
					const cfg = fileItem as EditByHashlineConfig;
					return {path: cfg.path, operations: cfg.operations};
				},
				(path: string, ops: HashlineOperation[]) =>
					this.editFileSingle(path, ops, contextLines),
				(path, result) => ({path, ...result}),
			);
		}

		if (!operations || operations.length === 0) {
			throw new Error('operations array is required and must not be empty');
		}

		return await this.editFileSingle(filePath, operations, contextLines);
	}

	/**
	 * Internal: edit a single file via hashline anchors.
	 * @private
	 */
	private async editFileSingle(
		filePath: string,
		operations: HashlineOperation[],
		contextLines: number,
	): Promise<EditByHashlineSingleResult> {
		try {
			const isRemote = this.isSSHPath(filePath);
			let content: string;
			let fullPath: string;

			if (isRemote) {
				content = await this.readRemoteFile(filePath);
				fullPath = filePath;
			} else {
				fullPath = this.resolvePath(filePath);
				if (!isAbsolute(filePath)) {
					await this.validatePath(fullPath);
				}
				content = await readFileWithEncoding(fullPath);
			}

			const lines = content.split('\n');

			// ── Backup for rollback ──
			try {
				const {getConversationContext} = await import(
					'../utils/codebase/conversationContext.js'
				);
				const ctx = getConversationContext();
				if (ctx) {
					const {hashBasedSnapshotManager} = await import(
						'../utils/codebase/hashBasedSnapshot.js'
					);
					await hashBasedSnapshotManager.backupFile(
						ctx.sessionId,
						ctx.messageIndex,
						filePath,
						this.basePath,
						true,
						content,
					);
				}
			} catch {
				// non-fatal
			}

			// ── Validate ALL anchors before mutating anything ──
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
						`Operation ${originalIndex + 1} (${op.type}): endAnchor is required. ` +
							`For a single-line replace or delete, set endAnchor to the same "lineNum:hash" as startAnchor. ` +
							`For insert_after, repeat startAnchor as endAnchor.`,
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
					if (bothInsertAfter) {
						continue;
					}

					const sameSingleLineAnchor =
						sameStartLine &&
						current.startLine === current.endLine &&
						next.startLine === next.endLine;
					const hasInsertAfter =
						current.op.type === 'insert_after' ||
						next.op.type === 'insert_after';
					if (sameSingleLineAnchor && hasInsertAfter) {
						continue;
					}

					const overlaps =
						current.startLine <= next.endLine &&
						next.startLine <= current.endLine;
					if (!overlaps) {
						continue;
					}

					conflictErrors.push(
						`Operation ${current.originalIndex + 1} (${current.op.type} ${
							current.startLine
						}-${current.endLine}) conflicts with ` +
							`operation ${next.originalIndex + 1} (${next.op.type} ${
								next.startLine
							}-${next.endLine})`,
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

			// ── Sort operations bottom-to-top to keep line numbers stable ──
			const sortedOps = [...preparedOps].sort((a, b) => {
				if (a.startLine !== b.startLine) {
					return b.startLine - a.startLine;
				}

				const aInsertAfter = a.op.type === 'insert_after';
				const bInsertAfter = b.op.type === 'insert_after';
				if (aInsertAfter && bInsertAfter) {
					return b.originalIndex - a.originalIndex;
				}

				if (aInsertAfter !== bInsertAfter) {
					return aInsertAfter ? -1 : 1;
				}

				if (a.endLine !== b.endLine) {
					return b.endLine - a.endLine;
				}

				return b.originalIndex - a.originalIndex;
			});

			// Track the overall edit range for context display
			let editStartLine = Infinity;
			let editEndLine = 0;

			const mutableLines = [...lines];
			const opSummaries: string[] = [];

			// Strip hashline prefixes that less-capable models may accidentally
			// copy from filesystem-read output into their content.
			// The exact format is "lineNum:hash→content" (e.g. "42:a3→actual code"),
			// requiring both the 2-char hex hash AND the → arrow to avoid false positives.
			const hashlineContentRe = /^\s*\d+:[0-9a-fA-F]{2}→/;
			const sanitizeContent = (raw: string): string => {
				const contentLines = raw.split('\n');
				const hasHashlines =
					contentLines.length > 0 &&
					contentLines.every(l => l === '' || hashlineContentRe.test(l));
				if (!hasHashlines) return raw;
				return contentLines
					.map(l => {
						let s = l;
						let m: RegExpExecArray | null;
						while ((m = hashlineContentRe.exec(s))) {
							s = s.slice(m[0].length);
						}
						return s;
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
						mutableLines.splice(
							startLine - 1,
							endLine - startLine + 1,
							...newLines,
						);
						opSummaries.push(
							`replace lines ${startLine}-${endLine} → ${newLines.length} line(s)`,
						);
						break;
					}
					case 'insert_after': {
						const newLines = sanitizeContent(op.content ?? '').split('\n');
						mutableLines.splice(startLine, 0, ...newLines);
						opSummaries.push(
							`insert ${newLines.length} line(s) after line ${startLine}`,
						);
						break;
					}
					case 'delete': {
						mutableLines.splice(startLine - 1, endLine - startLine + 1);
						opSummaries.push(`delete lines ${startLine}-${endLine}`);
						break;
					}
				}
			}

			// ── Build before/after content for DiffViewer ──
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

			// ── Write ──
			if (isRemote) {
				await this.writeRemoteFile(fullPath, modifiedContent);
			} else {
				await writeFileWithEncoding(fullPath, modifiedContent);
			}

			// ── Optional Prettier format ──
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
				this.prettierSupportedExtensions.includes(fileExtension);

			if (shouldFormat) {
				try {
					const prettierConfig = await prettier.resolveConfig(fullPath);
					const formatted = await prettier.format(modifiedContent, {
						filepath: fullPath,
						...prettierConfig,
					});
					if (isRemote) {
						await this.writeRemoteFile(fullPath, formatted);
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

			// ── Structure analysis ──
			const structureAnalysis = analyzeCodeStructure(
				finalLines.join('\n'),
				filePath,
				finalLines.slice(
					editStartLine - 1,
					editStartLine - 1 + (editEndLine - editStartLine + 1),
				),
			);

			// ── IDE diagnostics ──
			// 延迟等待 IDE 完成文件变化的重新分析，避免拿到旧诊断
			let diagnostics: Diagnostic[] = [];
			try {
				await new Promise<void>(r => setTimeout(r, 500));
				diagnostics = await vscodeConnection.requestDiagnostics(fullPath);
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
				diagnostics: undefined as Diagnostic[] | undefined,
			};

			// ── Diagnostics report ──
			if (diagnostics.length > 0) {
				const limitedDiagnostics = diagnostics.slice(0, 10);
				result.diagnostics = limitedDiagnostics;

				const errorCount = diagnostics.filter(
					d => d.severity === 'error',
				).length;
				const warningCount = diagnostics.filter(
					d => d.severity === 'warning',
				).length;

				if (errorCount > 0 || warningCount > 0) {
					result.message += `\n\n⚠️  Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)`;
					const fmt = diagnostics
						.filter(d => d.severity === 'error' || d.severity === 'warning')
						.slice(0, 5)
						.map(d => {
							const icon = d.severity === 'error' ? '❌' : '⚠️';
							return `   ${icon} [${d.source || 'unknown'}] ${filePath}:${
								d.line
							}:${d.character}\n      ${d.message}`;
						})
						.join('\n\n');
					result.message += `\n\n📋 Details:\n${fmt}`;
					if (errorCount + warningCount > 5) {
						result.message += `\n   ... and ${
							errorCount + warningCount - 5
						} more`;
					}
				}
			}

			// ── Structure warnings ──
			const sw: string[] = [];
			if (!structureAnalysis.bracketBalance.curly.balanced) {
				const d =
					structureAnalysis.bracketBalance.curly.open -
					structureAnalysis.bracketBalance.curly.close;
				sw.push(
					`Curly brackets: ${
						d > 0 ? `${d} unclosed {` : `${Math.abs(d)} extra }`
					}`,
				);
			}
			if (!structureAnalysis.bracketBalance.round.balanced) {
				const d =
					structureAnalysis.bracketBalance.round.open -
					structureAnalysis.bracketBalance.round.close;
				sw.push(
					`Round brackets: ${
						d > 0 ? `${d} unclosed (` : `${Math.abs(d)} extra )`
					}`,
				);
			}
			if (!structureAnalysis.bracketBalance.square.balanced) {
				const d =
					structureAnalysis.bracketBalance.square.open -
					structureAnalysis.bracketBalance.square.close;
				sw.push(
					`Square brackets: ${
						d > 0 ? `${d} unclosed [` : `${Math.abs(d)} extra ]`
					}`,
				);
			}
			if (structureAnalysis.htmlTags && !structureAnalysis.htmlTags.balanced) {
				if (structureAnalysis.htmlTags.unclosedTags.length > 0) {
					sw.push(
						`Unclosed HTML tags: ${structureAnalysis.htmlTags.unclosedTags.join(
							', ',
						)}`,
					);
				}
				if (structureAnalysis.htmlTags.unopenedTags.length > 0) {
					sw.push(
						`Unopened closing tags: ${structureAnalysis.htmlTags.unopenedTags.join(
							', ',
						)}`,
					);
				}
			}
			if (structureAnalysis.indentationWarnings.length > 0) {
				sw.push(
					...structureAnalysis.indentationWarnings.map(
						(w: string) => `Indentation: ${w}`,
					),
				);
			}
			if (sw.length > 0) {
				result.message += `\n\n🔍 Structure Analysis:\n`;
				sw.forEach(w => {
					result.message += `   ⚠️  ${w}\n`;
				});
				result.message += `\n   💡 TIP: These warnings help identify potential issues.`;
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
	 * Supports contextPath for smart relative path resolution in batch operations
	 * @param filePath - Path to resolve
	 * @param contextPath - Optional context path (e.g., previous absolute path in batch)
	 *                      If provided and filePath is relative, will resolve relative to contextPath's directory
	 * @private
	 */
	private resolvePath(filePath: string, contextPath?: string): string {
		// Check if the path is already absolute
		const isAbs = path.isAbsolute(filePath);

		if (isAbs) {
			// Return absolute path as-is (will be validated later)
			return resolve(filePath);
		}

		// For relative paths, resolve against context path if provided
		// Remove any leading slashes or backslashes to treat as relative path
		const relativePath = filePath.replace(/^[\/\\]+/, '');

		// If context path is provided and is absolute, resolve relative to its directory
		if (contextPath && path.isAbsolute(contextPath)) {
			return resolve(path.dirname(contextPath), relativePath);
		}

		// Otherwise resolve against base path
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
			'Read file content with line numbers and content hashes. Supports text files, images, Office documents, and directories. **REMOTE SSH SUPPORT**: Fully supports remote files via SSH URL format (ssh://user@host:port/path). **PATH REQUIREMENT**: Use EXACT paths from search results or user input, never undefined/null/empty/placeholders. **WORKFLOW**: (1) Use search tools FIRST to locate files, (2) Read only when you have the exact path. **SUPPORTS**: Single file (string), multiple files (array of strings), or per-file ranges (array of {path, startLine?, endLine?}). Returns content with hashline anchors (format: "lineNum:hash→code", e.g. "42:a3→const x = 1;"). Use these anchors with filesystem-edit for safe editing.',
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
			'Create a new file with content. **PATH REQUIREMENT**: Use EXACT non-empty string path, never undefined/null/empty/placeholders like "path/to/file". Set `overwrite` to true to replace an existing file (original content is backed up for rollback). Automatically creates parent directories.',
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
				overwrite: {
					type: 'boolean',
					description:
						'Whether to overwrite the file if it already exists. When true, the existing file content is backed up for rollback before being replaced. When false, an error is thrown if the file already exists.',
				},
				createDirectories: {
					type: 'boolean',
					description:
						"Whether to create parent directories if they don't exist",
					default: true,
				},
			},
			required: ['filePath', 'content', 'overwrite'],
		},
	},
	{
		name: 'filesystem-replaceedit',
		description:
			'DEFAULT edit tool: Fuzzy search-and-replace editing. ' +
			'**WHEN**: Prefer this for normal workflow and diff-friendly context display. Use `filesystem-edit` when you need strict hash-anchored safety checks. ' +
			'**REMOTE SSH**: Supports ssh:// paths like other filesystem tools. ' +
			'**INPUT**: `searchContent` must be raw source text — strip `lineNum:hash→` prefixes if you pasted from `filesystem-read`. ' +
			'**BATCH**: `filePath` may be a string, string[] with top-level search/replace, or {path, searchContent, replaceContent, occurrence?}[]. ' +
			'Uses fuzzy similarity matching (fixed threshold 0.75).',
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
						'Content to find and replace (for single file or unified mode). Raw file text only — no hashline prefixes.',
				},
				replaceContent: {
					type: 'string',
					description:
						'New content to replace with (for single file or unified mode)',
				},
				occurrence: {
					type: 'number',
					description:
						'Which match to replace if multiple found (1-indexed). Default: 1 (best match first). Use -1 only when a single match exists (same as occurrence 1).',
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
			'OPTIONAL strict edit tool: Hash-anchored editing using content hashes from filesystem-read. ' +
			'Line format: "lineNum:hash→content" (e.g. "42:a3→code"). Use anchors "lineNum:hash" to reference lines — no text reproduction needed. ' +
			'**OPERATIONS**: (1) replace — replaces startAnchor..endAnchor with content; ' +
			'(2) insert_after — inserts content after startAnchor; ' +
			'(3) delete — removes startAnchor..endAnchor, set content to empty string "". ' +
			'**WORKFLOW**: filesystem-read → note anchors → call this tool with operations. ' +
			'**ANCHOR FORMAT**: "lineNum:hash" e.g. "10:a3". endAnchor is always required (inclusive range). Single-line edits: set endAnchor to the same anchor as startAnchor. ' +
			'**SUPPORTS BATCH**: Pass array of {path, operations} for multi-file edits.',
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
								type: 'object',
								properties: {
									path: {
										type: 'string',
										description: 'File path',
									},
									operations: {
										type: 'array',
										items: {
											type: 'object',
											properties: {
												type: {
													type: 'string',
													enum: ['replace', 'insert_after', 'delete'],
													description: 'Operation type',
												},
												startAnchor: {
													type: 'string',
													description:
														'Start anchor from filesystem-read (format: "lineNum:hash", e.g. "42:a3")',
												},
												endAnchor: {
													type: 'string',
													description:
														'Inclusive end anchor (format: "lineNum:hash"). For a single line, use the same value as startAnchor.',
												},
												content: {
													type: 'string',
													description:
														'New content to write (for replace and insert_after). Pass empty string "" for delete. Do NOT include line numbers or hashes.',
												},
											},
											required: [
												'type',
												'startAnchor',
												'endAnchor',
												'content',
											],
										},
										description: 'Array of edit operations for this file',
									},
								},
								required: ['path', 'operations'],
							},
							description:
								'Array of per-file hashline edit configs for batch editing',
						},
					],
					description:
						'File path (string) or batch configs (array of {path, operations})',
				},
				operations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							type: {
								type: 'string',
								enum: ['replace', 'insert_after', 'delete'],
								description: 'Operation type',
							},
							startAnchor: {
								type: 'string',
								description:
									'Start anchor from filesystem-read output (format: "lineNum:hash", e.g. "10:a3")',
							},
							endAnchor: {
								type: 'string',
								description:
									'Inclusive end anchor (format: "lineNum:hash"). For a single line, use the same value as startAnchor.',
							},
							content: {
								type: 'string',
								description:
									'New content to write (for replace and insert_after). Pass empty string "" for delete. Do NOT include line numbers or hashes.',
							},
						},
						required: ['type', 'startAnchor', 'endAnchor', 'content'],
					},
					description:
						'Array of edit operations (for single file mode). Each operation references anchors from filesystem-read.',
				},
				contextLines: {
					type: 'number',
					description: 'Context lines to show before/after edit (default: 8)',
					default: 8,
				},
			},
			required: ['filePath'],
		},
	},
];
