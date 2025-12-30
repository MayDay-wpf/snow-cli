import fs from 'fs';
import path from 'path';

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
	return new Promise(resolve => {
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
	const imageExtensions = [
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.webp',
		'.bmp',
		'.svg',
	];
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
		'.svg': 'image/svg+xml',
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
			mimeType,
		};
	} catch (error) {
		return {
			path: filePath,
			lineCount: 0,
			exists: false,
		};
	}
}

/**
 * Format file tree display for messages
 */
export function formatFileTree(files: SelectedFile[]): string {
	if (files.length === 0) return '';

	return files
		.map(
			file =>
				`└─ Read \`${file.path}\`${
					file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'
				}`,
		)
		.join('\n');
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
	const directPathRegex =
		/(?<!@)(?:^|\s)((?:[a-zA-Z]:[\\\/]|\.{1,2}[\\\/]|[\\\/])(?:[A-Za-z0-9\-._/\\:()[\] ]+)\.[a-zA-Z]+)(?=\s|$)/g;

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
		uniqueFiles.map(async filePath => {
			const info = await getFileInfo(filePath);
			return info;
		}),
	);

	// Filter only existing files
	const validFiles = fileInfos.filter(file => file.exists);

	// Clean content - keep paths as user typed them
	const cleanContent = content;

	return {
		cleanContent,
		validFiles,
	};
}

/**
 * Create message with file read instructions for AI
 * Returns content and editorContext separately for clean storage and rendering
 */
export function createMessageWithFileInstructions(
	content: string,
	files: SelectedFile[],
	editorContext?: {
		activeFile?: string;
		selectedText?: string;
		cursorPosition?: {line: number; character: number};
		workspaceFolder?: string;
	},
): {content: string; editorContext?: typeof editorContext} {
	const parts: string[] = [content];

	// Add file instructions if provided
	if (files.length > 0) {
		const fileInstructions = files
			.map(f => `└─ Read \`${f.path}\` (total line ${f.lineCount})`)
			.join('\n');
		parts.push(fileInstructions);
	}

	// Return content and editorContext separately instead of concatenating
	// This allows editorContext to be stored independently and only sent to AI when needed
	return {
		content: parts.join('\n'),
		editorContext,
	};
}

/**
 * Clean IDE context information from message content
 * Removes all lines that start with "└─" (IDE context prefix)
 * Also removes code blocks that follow "└─ Selected Code:" lines
 */
export function cleanIDEContext(content: string): string {
	const lines = content.split('\n');
	const result: string[] = [];
	let skipCodeBlock = false;
	let codeBlockDepth = 0;

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Check if this line starts a Selected Code context
		if (trimmedLine.startsWith('└─ Selected Code:')) {
			skipCodeBlock = true;
			codeBlockDepth = 0;
			continue;
		}

		// Skip other IDE context lines
		if (trimmedLine.startsWith('└─')) {
			continue;
		}

		// Handle code block tracking when in skip mode
		if (skipCodeBlock) {
			if (trimmedLine.startsWith('```')) {
				codeBlockDepth++;
				if (codeBlockDepth >= 2) {
					// We've seen opening and closing ```, done skipping
					skipCodeBlock = false;
					codeBlockDepth = 0;
				}
				continue;
			}
			// Skip content inside the code block
			if (codeBlockDepth >= 1) {
				continue;
			}
		}

		result.push(line);
	}

	return result.join('\n').trim();
}
