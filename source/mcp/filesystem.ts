import {promises as fs} from 'fs';
import * as path from 'path';
// IDE connection supports both VSCode and JetBrains IDEs
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
	ImageContent,
} from './types/filesystem.types.js';
import {IMAGE_MIME_TYPES, OFFICE_FILE_TYPES} from './types/filesystem.types.js';
import {
	parseEditBySearchParams,
	executeBatchOperation,
} from './utils/filesystem/batch-operations.utils.js';
import {tryFixPath} from './utils/filesystem/path-fixer.utils.js';
import {getFreshDiagnostics} from './utils/filesystem/diagnostics.utils.js';
import {
	appendDiagnosticsSummary,
} from './utils/filesystem/message-format.utils.js';
import {backupFileBeforeMutation} from './utils/filesystem/backup.utils.js';
import {
	executeEditBySearchSingle,
	executeHashlineEditSingle,
} from './utils/filesystem/edit-tools.utils.js';
import {executeGetFileContentCore} from './utils/filesystem/read-tools.utils.js';
import type {CodeSymbol} from './types/aceCodeSearch.types.js';
// Notebook utilities for automatic note retrieval
import {queryNotebook} from '../utils/core/notebookManager.js';
// Encoding detection and conversion utilities
import {
	readFileWithEncoding,
	writeFileWithEncoding,
} from './utils/filesystem/encoding.utils.js';

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

			return await executeGetFileContentCore(
				{
					basePath: this.basePath,
					resolvePath: this.resolvePath.bind(this),
					validatePath: this.validatePath.bind(this),
					listFiles: this.listFiles.bind(this),
					isSSHPath: this.isSSHPath.bind(this),
					readRemoteFile: this.readRemoteFile.bind(this),
					isImageFile: this.isImageFile.bind(this),
					readImageAsBase64: this.readImageAsBase64.bind(this),
					isOfficeFile: this.isOfficeFile.bind(this),
					getNotebookEntries: this.getNotebookEntries.bind(this),
					extractRelevantSymbols: this.extractRelevantSymbols.bind(this),
				},
				filePath,
				startLine,
				endLine,
			);
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
			await backupFileBeforeMutation({
				filePath,
				basePath: this.basePath,
				fileExisted,
				originalContent,
			});

			// Create parent directories if needed
			if (createDirectories) {
				const dir = dirname(fullPath);
				await fs.mkdir(dir, {recursive: true});
			}

			await writeFileWithEncoding(fullPath, content);

			let message = fileExisted
				? `File overwritten successfully: ${filePath}`
				: `File created successfully: ${filePath}`;

			// Try to fetch fresh diagnostics after create/overwrite to avoid stale results
			try {
				const diagnostics = await getFreshDiagnostics(fullPath);
				if (diagnostics.length > 0) {
					message = appendDiagnosticsSummary(message, filePath, diagnostics);
				}
			} catch {
				// Optional diagnostics retrieval, do not block create success
			}

			return message;
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
		return await executeEditBySearchSingle(
			{
				basePath: this.basePath,
				prettierSupportedExtensions: this.prettierSupportedExtensions,
				isSSHPath: this.isSSHPath.bind(this),
				readRemoteFile: this.readRemoteFile.bind(this),
				writeRemoteFile: this.writeRemoteFile.bind(this),
				resolvePath: this.resolvePath.bind(this),
				validatePath: this.validatePath.bind(this),
			},
			filePath,
			searchContent,
			replaceContent,
			occurrence,
			contextLines,
		);
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
		return await executeHashlineEditSingle(
			{
				basePath: this.basePath,
				prettierSupportedExtensions: this.prettierSupportedExtensions,
				isSSHPath: this.isSSHPath.bind(this),
				readRemoteFile: this.readRemoteFile.bind(this),
				writeRemoteFile: this.writeRemoteFile.bind(this),
				resolvePath: this.resolvePath.bind(this),
				validatePath: this.validatePath.bind(this),
			},
			filePath,
			operations,
			contextLines,
		);
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
