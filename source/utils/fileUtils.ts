import fs from 'fs';
import path from 'path';

export interface SelectedFile {
	path: string;
	lineCount: number;
	exists: boolean;
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
		
		const lineCount = exists ? await getFileLineCount(actualPath) : 0;

		return {
			path: filePath, // Keep original path for display
			lineCount,
			exists
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
 */
export async function parseAndValidateFileReferences(content: string): Promise<{
	cleanContent: string;
	validFiles: SelectedFile[];
}> {
	// Updated regex to handle more complex file paths including uppercase, numbers, and more special chars
	const fileRegex = /@([A-Za-z0-9\-._/\\]+\.[a-zA-Z]+)(?=\s|$)/g;
	const foundFiles: string[] = [];
	let match;
	
	// Find all file references
	while ((match = fileRegex.exec(content)) !== null) {
		if (match[1]) {
			foundFiles.push(match[1]);
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
	
	// Clean content - keep @ symbols as user typed them
	const cleanContent = content;
	
	return {
		cleanContent,
		validFiles
	};
}

/**
 * Create message with file read instructions for AI
 */
export function createMessageWithFileInstructions(content: string, files: SelectedFile[]): string {
	if (files.length === 0) {
		return content;
	}
	
	const fileInstructions = files
		.map(f => `└─ Read \`${f.path}\` (total line ${f.lineCount})`)
		.join('\n');
	
	return content + '\n' + fileInstructions;
}