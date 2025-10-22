import fs from 'fs';
import path from 'path';
import os from 'os';

export interface SelectedFile {
	path: string;
	lineCount: number;
	exists: boolean;
	isImage?: boolean;
	imageData?: string; // Base64 data URL
	mimeType?: string;
}

/**
 * Get line count for a file
 */
export function getFileLineCount(filePath: string): Promise<number> {
	return new Promise((resolve) => {
		try {
			if (!fs.existsSync(filePath)) {
				resolve(0);
				return;
			}

			const content = fs.readFileSync(filePath, 'utf-8');
			const lines = content.split('\n').length;
			resolve(lines);
		} catch (error) {
			resolve(0);
		}
	});
}

/**
 * Check if file is an image based on extension
 */
function isImageFile(filePath: string): boolean {
	const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
	const ext = path.extname(filePath).toLowerCase();
	return imageExtensions.includes(ext);
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	const mimeTypes: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.bmp': 'image/bmp',
		'.svg': 'image/svg+xml'
	};
	return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Get file information including line count
 */
export async function getFileInfo(filePath: string): Promise<SelectedFile> {
	try {
		// Try multiple path resolutions in order of preference
		const pathsToTry = [
			filePath, // Original path as provided
			path.resolve(process.cwd(), filePath), // Relative to current working directory
			path.resolve(filePath), // Absolute resolution
		];

		// Remove duplicates while preserving order
		const uniquePaths = [...new Set(pathsToTry)];

		let actualPath = filePath;
		let exists = false;

		// Try each path until we find one that exists
		for (const tryPath of uniquePaths) {
			if (fs.existsSync(tryPath)) {
				actualPath = tryPath;
				exists = true;
				break;
			}
		}

		// Check if it's an image file
		const isImage = isImageFile(actualPath);
		let imageData: string | undefined;
		let mimeType: string | undefined;
		let lineCount = 0;

		if (exists) {
			if (isImage) {
				// Read image as base64
				const buffer = fs.readFileSync(actualPath);
				const base64 = buffer.toString('base64');
				mimeType = getMimeType(actualPath);
				imageData = `data:${mimeType};base64,${base64}`;
			} else {
				lineCount = await getFileLineCount(actualPath);
			}
		}

		return {
			path: filePath, // Keep original path for display
			lineCount,
			exists,
			isImage,
			imageData,
			mimeType
		};
	} catch (error) {
		return {
			path: filePath,
			lineCount: 0,
			exists: false
		};
	}
}

/**
 * Format file tree display for messages
 */
export function formatFileTree(files: SelectedFile[]): string {
	if (files.length === 0) return '';
	
	return files.map(file => 
		`└─ Read \`${file.path}\`${file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}`
	).join('\n');
}

/**
 * Parse @file references from message content and check if they exist
 * Also supports direct file paths (pasted from VSCode drag & drop)
 */
export async function parseAndValidateFileReferences(content: string): Promise<{
	cleanContent: string;
	validFiles: SelectedFile[];
}> {
	const foundFiles: string[] = [];

	// Pattern 1: @file references (e.g., @path/to/file.ts)
	const atFileRegex = /@([A-Za-z0-9\-._/\\:]+\.[a-zA-Z]+)(?=\s|$)/g;
	let match;

	while ((match = atFileRegex.exec(content)) !== null) {
		if (match[1]) {
			foundFiles.push(match[1]);
		}
	}

	// Pattern 2: Direct absolute/relative paths (e.g., c:\Users\...\file.ts or ./src/file.ts)
	// Match paths that look like file paths with extensions, but NOT @-prefixed ones
	const directPathRegex = /(?<!@)(?:^|\s)((?:[a-zA-Z]:[\\\/]|\.{1,2}[\\\/]|[\\\/])(?:[A-Za-z0-9\-._/\\:()[\] ]+)\.[a-zA-Z]+)(?=\s|$)/g;

	while ((match = directPathRegex.exec(content)) !== null) {
		if (match[1]) {
			const trimmedPath = match[1].trim();
			// Only add if it looks like a real file path
			if (trimmedPath && !foundFiles.includes(trimmedPath)) {
				foundFiles.push(trimmedPath);
			}
		}
	}

	// Remove duplicates
	const uniqueFiles = [...new Set(foundFiles)];

	// Check which files actually exist
	const fileInfos = await Promise.all(
		uniqueFiles.map(async (filePath) => {
			const info = await getFileInfo(filePath);
			return info;
		})
	);

	// Filter only existing files
	const validFiles = fileInfos.filter(file => file.exists);

	// Clean content - keep paths as user typed them
	const cleanContent = content;

	return {
		cleanContent,
		validFiles
	};
}

/**
 * Create message with file read instructions for AI
 */
export function createMessageWithFileInstructions(
	content: string,
	files: SelectedFile[],
	systemInfo?: {platform: string; shell: string; workingDirectory: string},
	editorContext?: {activeFile?: string; selectedText?: string; cursorPosition?: {line: number; character: number}; workspaceFolder?: string}
): string {
	const parts: string[] = [content];

	// Add system info if provided
	if (systemInfo) {
		const systemInfoLines = [
			`└─ Platform: ${systemInfo.platform}`,
			`└─ Shell: ${systemInfo.shell}`,
			`└─ Working Directory: ${systemInfo.workingDirectory}`
		];
		parts.push(systemInfoLines.join('\n'));
	}

	// Add editor context if provided (from VSCode connection)
	if (editorContext) {
		const editorLines: string[] = [];
		if (editorContext.workspaceFolder) {
			editorLines.push(`└─ VSCode Workspace: ${editorContext.workspaceFolder}`);
		}
		if (editorContext.activeFile) {
			editorLines.push(`└─ Active File: ${editorContext.activeFile}`);
		}
		if (editorContext.cursorPosition) {
			editorLines.push(`└─ Cursor: Line ${editorContext.cursorPosition.line + 1}, Column ${editorContext.cursorPosition.character + 1}`);
		}
		// if (editorContext.selectedText) {
		// 	editorLines.push(`└─ Selected Code:\n\`\`\`\n${editorContext.selectedText}\n\`\`\``);
		// }
		if (editorLines.length > 0) {
			parts.push(editorLines.join('\n'));
		}
	}

	// Add file instructions if provided
	if (files.length > 0) {
		const fileInstructions = files
			.map(f => `└─ Read \`${f.path}\` (total line ${f.lineCount})`)
			.join('\n');
		parts.push(fileInstructions);
	}

	return parts.join('\n');
}

/**
 * Get system information (OS, shell, working directory)
 */
export function getSystemInfo(): {platform: string; shell: string; workingDirectory: string} {
	// Get OS platform
	const platform = (() => {
		const platformType = os.platform();
		switch (platformType) {
			case 'win32':
				return 'Windows';
			case 'darwin':
				return 'macOS';
			case 'linux':
				return 'Linux';
			default:
				return platformType;
		}
	})();

	// Get shell type
	const shell = (() => {
		const shellPath = process.env['SHELL'] || process.env['ComSpec'] || '';
		const shellName = path.basename(shellPath).toLowerCase();

		if (shellName.includes('cmd')) return 'cmd.exe';
		if (shellName.includes('powershell')) return 'PowerShell';
		if (shellName.includes('pwsh')) return 'PowerShell';
		if (shellName.includes('zsh')) return 'zsh';
		if (shellName.includes('bash')) return 'bash';
		if (shellName.includes('fish')) return 'fish';
		if (shellName.includes('sh')) return 'sh';

		return shellName || 'shell';
	})();

	// Get working directory
	const workingDirectory = process.cwd();

	return {
		platform,
		shell,
		workingDirectory
	};
}