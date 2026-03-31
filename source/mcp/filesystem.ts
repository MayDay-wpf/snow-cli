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
	HashlineOperation,
	SingleFileReadResult,
	MultipleFilesReadResult,
	MultimodalContent,
	ImageContent,
} from './types/filesystem.types.js';
import {IMAGE_MIME_TYPES, OFFICE_FILE_TYPES} from './types/filesystem.types.js';
// Utility functions
import {normalizeForDisplay} from './utils/filesystem/similarity.utils.js';
import {
	analyzeCodeStructure,
	findSmartContextBoundaries,
} from './utils/filesystem/code-analysis.utils.js';
import {executeBatchOperation} from './utils/filesystem/batch-operations.utils.js';
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
	parseAnchor,
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

			const sizeInfo = `[File: ${Math.round(fileSizeBytes / 1024 / 1024)}MB, ${totalLines} lines total. Showing lines ${start}-${end}. Use startLine/endLine to read other sections.]`;
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

			// Backup for rollback (new file, didn't exist before)
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
						false, // File didn't exist
						undefined,
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
	 * Edit file(s) using hashline anchors.
	 *
	 * Each operation references lines by `lineNum:hash` anchors obtained from
	 * a previous `filesystem-read`.  Hashes are validated before any mutation
	 * so stale reads are caught early.
	 *
	 * Supported operation types:
	 *   • replace  – replace startAnchor..endAnchor with content
	 *   • insert_after – insert content after startAnchor
	 *   • delete   – delete startAnchor..endAnchor
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
				(fileItem) => {
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
			const anchorErrors: string[] = [];
			for (const op of operations) {
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
				if (op.endAnchor) {
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
					}
					if (startV.valid && endV.valid && endV.lineNum < startV.lineNum) {
						anchorErrors.push(
							`endAnchor line ${endV.lineNum} is before startAnchor line ${startV.lineNum}`,
						);
					}
				}

				if ((op.type === 'replace' || op.type === 'insert_after') && op.content === undefined) {
					anchorErrors.push(`Operation "${op.type}" requires content`);
				}
			}

			if (anchorErrors.length > 0) {
				throw new Error(
					`❌ Hashline anchor validation failed for ${filePath}:\n` +
						anchorErrors.map(e => `  • ${e}`).join('\n') +
						`\n\n💡 The file may have changed since your last read. Re-read the file to get fresh anchors.`,
				);
			}

			// ── Sort operations bottom-to-top to keep line numbers stable ──
			const sortedOps = [...operations].sort((a, b) => {
				const aLine = parseAnchor(a.startAnchor)!.lineNum;
				const bLine = parseAnchor(b.startAnchor)!.lineNum;
				return bLine - aLine;
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
			const hasHashlines = contentLines.length > 0 &&
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

		for (const op of sortedOps) {
			const startLine = parseAnchor(op.startAnchor)!.lineNum;
			const endLine = op.endAnchor
				? parseAnchor(op.endAnchor)!.lineNum
				: startLine;

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
				finalLines.slice(editStartLine - 1, editStartLine - 1 + (editEndLine - editStartLine + 1)),
			);

			// ── IDE diagnostics ──
			let diagnostics: Diagnostic[] = [];
			try {
				diagnostics = await Promise.race([
					vscodeConnection.requestDiagnostics(fullPath),
					new Promise<Diagnostic[]>(resolve => setTimeout(() => resolve([]), 1000)),
				]);
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

				const errorCount = diagnostics.filter(d => d.severity === 'error').length;
				const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

				if (errorCount > 0 || warningCount > 0) {
					result.message += `\n\n⚠️  Diagnostics: ${errorCount} error(s), ${warningCount} warning(s)`;
					const fmt = diagnostics
						.filter(d => d.severity === 'error' || d.severity === 'warning')
						.slice(0, 5)
						.map(d => {
							const icon = d.severity === 'error' ? '❌' : '⚠️';
							return `   ${icon} [${d.source || 'unknown'}] ${filePath}:${d.line}:${d.character}\n      ${d.message}`;
						})
						.join('\n\n');
					result.message += `\n\n📋 Details:\n${fmt}`;
					if (errorCount + warningCount > 5) {
						result.message += `\n   ... and ${errorCount + warningCount - 5} more`;
					}
				}
			}

			// ── Structure warnings ──
			const sw: string[] = [];
			if (!structureAnalysis.bracketBalance.curly.balanced) {
				const d = structureAnalysis.bracketBalance.curly.open - structureAnalysis.bracketBalance.curly.close;
				sw.push(`Curly brackets: ${d > 0 ? `${d} unclosed {` : `${Math.abs(d)} extra }`}`);
			}
			if (!structureAnalysis.bracketBalance.round.balanced) {
				const d = structureAnalysis.bracketBalance.round.open - structureAnalysis.bracketBalance.round.close;
				sw.push(`Round brackets: ${d > 0 ? `${d} unclosed (` : `${Math.abs(d)} extra )`}`);
			}
			if (!structureAnalysis.bracketBalance.square.balanced) {
				const d = structureAnalysis.bracketBalance.square.open - structureAnalysis.bracketBalance.square.close;
				sw.push(`Square brackets: ${d > 0 ? `${d} unclosed [` : `${Math.abs(d)} extra ]`}`);
			}
			if (structureAnalysis.htmlTags && !structureAnalysis.htmlTags.balanced) {
				if (structureAnalysis.htmlTags.unclosedTags.length > 0) {
					sw.push(`Unclosed HTML tags: ${structureAnalysis.htmlTags.unclosedTags.join(', ')}`);
				}
				if (structureAnalysis.htmlTags.unopenedTags.length > 0) {
					sw.push(`Unopened closing tags: ${structureAnalysis.htmlTags.unopenedTags.join(', ')}`);
				}
			}
			if (structureAnalysis.indentationWarnings.length > 0) {
				sw.push(...structureAnalysis.indentationWarnings.map((w: string) => `Indentation: ${w}`));
			}
			if (sw.length > 0) {
				result.message += `\n\n🔍 Structure Analysis:\n`;
				sw.forEach(w => { result.message += `   ⚠️  ${w}\n`; });
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
			'Create a new file with content. **PATH REQUIREMENT**: Use EXACT non-empty string path, never undefined/null/empty/placeholders like "path/to/file". Verify file does not exist first. Automatically creates parent directories.',
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
		name: 'filesystem-edit',
		description:
			'PREFERRED edit tool: Hash-anchored editing using content hashes from filesystem-read. ' +
			'Each line read has format "lineNum:hash→content" (e.g. "42:a3→code"). ' +
			'Reference lines by anchors ("42:a3") instead of copying text. ' +
			'**WHY USE THIS**: No text reproduction needed — avoids "string not found" failures, ' +
			'whitespace mismatches, and fuzzy matching ambiguity. If the file changed since your ' +
			'last read, hashes will mismatch and the edit is safely rejected. ' +
			'**OPERATIONS**: (1) replace — replace lines startAnchor..endAnchor with content, ' +
			'(2) insert_after — insert content after startAnchor, ' +
			'(3) delete — delete lines startAnchor..endAnchor. ' +
			'**WORKFLOW**: filesystem-read → note anchors → call this tool with operations. ' +
			'**ANCHOR FORMAT**: "lineNum:hash" e.g. "10:a3". For single-line replace/delete, omit endAnchor. ' +
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
														'End anchor for range operations (optional, omit for single-line)',
												},
												content: {
													type: 'string',
													description:
														'New content for replace/insert_after (not needed for delete)',
												},
											},
											required: ['type', 'startAnchor'],
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
					description: 'File path (string) or batch configs (array of {path, operations})',
				},
				operations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							type: {
								type: 'string',
								enum: ['replace', 'insert_after', 'delete'],
								description:
									'replace: replace anchor range with content. insert_after: insert after anchor. delete: remove anchor range.',
							},
							startAnchor: {
								type: 'string',
								description:
									'Start anchor from filesystem-read output (format: "lineNum:hash", e.g. "10:a3")',
							},
							endAnchor: {
								type: 'string',
								description:
									'End anchor for range operations (format: "lineNum:hash"). Omit for single-line replace/delete or insert_after.',
							},
							content: {
								type: 'string',
								description:
									'New content (for replace and insert_after). Do NOT include line numbers or hashes.',
							},
						},
						required: ['type', 'startAnchor'],
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
