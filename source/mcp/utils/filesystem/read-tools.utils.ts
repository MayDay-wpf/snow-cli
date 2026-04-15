import {promises as fs} from 'fs';
import {isAbsolute} from 'path';
import type {
	MultipleFilesReadResult,
	MultimodalContent,
	SingleFileReadResult,
} from '../../types/filesystem.types.js';
import type {CodeSymbol} from '../../types/aceCodeSearch.types.js';
import {parseFileSymbols} from '../aceCodeSearch/symbol.utils.js';
import {
	readFileLinesStreaming,
	readFileWithEncoding,
} from './encoding.utils.js';
import {readOfficeDocument} from './office-parser.utils.js';
import {formatLineWithHash} from './hashline.utils.js';

type GetFileContentContext = {
	basePath: string;
	resolvePath: (filePath: string, contextPath?: string) => string;
	validatePath: (fullPath: string) => Promise<void>;
	listFiles: (dirPath?: string) => Promise<string[]>;
	isSSHPath: (filePath: string) => boolean;
	readRemoteFile: (sshUrl: string) => Promise<string>;
	isImageFile: (filePath: string) => boolean;
	readImageAsBase64: (fullPath: string) => Promise<
		| {
				type: 'image';
				data: string;
				mimeType: string;
		  }
		| null
	>;
	isOfficeFile: (filePath: string) => boolean;
	getNotebookEntries: (filePath: string) => string;
	extractRelevantSymbols: (
		symbols: CodeSymbol[],
		startLine: number,
		endLine: number,
		totalLines: number,
	) => string;
};

export async function executeGetFileContentCore(
	ctx: GetFileContentContext,
	filePath:
		| string
		| string[]
		| Array<{path: string; startLine?: number; endLine?: number}>,
	startLine?: number,
	endLine?: number,
): Promise<SingleFileReadResult | MultipleFilesReadResult> {
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

		let lastAbsolutePath: string | undefined;

		for (const fileItem of filePath) {
			try {
				let file: string;
				let fileStartLine: number | undefined;
				let fileEndLine: number | undefined;

				if (typeof fileItem === 'string') {
					file = fileItem;
					fileStartLine = startLine;
					fileEndLine = endLine;
				} else {
					file = fileItem.path;
					fileStartLine = fileItem.startLine ?? startLine;
					fileEndLine = fileItem.endLine ?? endLine;
				}

				const fullPath = ctx.resolvePath(file, lastAbsolutePath);

				if (isAbsolute(file)) {
					lastAbsolutePath = fullPath;
				}

				if (!isAbsolute(file)) {
					await ctx.validatePath(fullPath);
				}

				const stats = await fs.stat(fullPath);
				if (stats.isDirectory()) {
					const dirFiles = await ctx.listFiles(file);
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

				if (ctx.isImageFile(fullPath)) {
					const imageContent = await ctx.readImageAsBase64(fullPath);
					if (imageContent) {
						multimodalContent.push({
							type: 'text',
							text: `🖼️  Image: ${file} (${imageContent.mimeType})`,
						});
						multimodalContent.push(imageContent);
						filesData.push({
							path: file,
							isImage: true,
							mimeType: imageContent.mimeType,
						});
						continue;
					}
				}

				if (ctx.isOfficeFile(fullPath)) {
					const docContent = await readOfficeDocument(fullPath);
					if (docContent) {
						multimodalContent.push({
							type: 'text',
							text: `📄 ${docContent.fileType.toUpperCase()} Document: ${file}`,
						});
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
						throw new Error(`Start line must be greater than 0 for ${file}`);
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

				const actualStartLine = fileStartLine ?? 1;
				const actualEndLine =
					fileSizeBytes > FILE_SIZE_LIMIT
						? fileEndLine ?? 500
						: fileEndLine ?? totalLines;

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
				const selectedLines =
					fileSizeBytes > FILE_SIZE_LIMIT ? lines : lines.slice(start - 1, end);
				const numberedLines = selectedLines.map((line, index) =>
					formatLineWithHash(start + index, line),
				);

				const sizeWarning =
					fileSizeBytes > FILE_SIZE_LIMIT
						? ` [Large file: ${Math.round(fileSizeBytes / 1024 / 1024)}MB]`
						: '';
				let fileContent = `📄 ${file} (lines ${start}-${end}/${totalLines})${sizeWarning}\n${numberedLines.join('\n')}`;

				if (content) {
					try {
						const symbols = await parseFileSymbols(fullPath, content, ctx.basePath);
						const symbolInfo = ctx.extractRelevantSymbols(
							symbols,
							start,
							end,
							totalLines,
						);
						if (symbolInfo) {
							fileContent += symbolInfo;
						}
					} catch {
						// optional
					}
				}

				const notebookInfo = ctx.getNotebookEntries(file);
				if (notebookInfo) {
					fileContent += notebookInfo;
				}

				multimodalContent.push({type: 'text', text: fileContent});
				filesData.push({path: file, startLine: start, endLine: end, totalLines});
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				const inputPath = typeof fileItem === 'string' ? fileItem : fileItem.path;
				let resolvedPathInfo = '';
				try {
					const attemptedResolve = ctx.resolvePath(inputPath, lastAbsolutePath);
					if (attemptedResolve !== inputPath) {
						resolvedPathInfo = `\n   Resolved to: ${attemptedResolve}`;
					}
				} catch {
					// ignore
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

	if (ctx.isSSHPath(filePath)) {
		const content = await ctx.readRemoteFile(filePath);
		const lines = content.split('\n');
		const totalLines = lines.length;
		const actualStartLine = startLine ?? 1;
		const actualEndLine = endLine ?? totalLines;
		if (actualStartLine < 1) {
			throw new Error('Start line must be greater than 0');
		}
		if (actualEndLine < actualStartLine) {
			throw new Error('End line must be greater than or equal to start line');
		}
		const start = Math.min(actualStartLine, totalLines);
		const end = Math.min(totalLines, actualEndLine);
		const selectedLines = lines.slice(start - 1, end);
		const numberedLines = selectedLines.map(
			(line, index) => `${start + index}->${line}`,
		);
		return {
			content: numberedLines.join('\n'),
			startLine: start,
			endLine: end,
			totalLines,
		};
	}

	const fullPath = ctx.resolvePath(filePath);
	if (!isAbsolute(filePath)) {
		await ctx.validatePath(fullPath);
	}

	const stats = await fs.stat(fullPath);
	if (stats.isDirectory()) {
		const files = await ctx.listFiles(filePath);
		const fileList = files.join('\n');
		const lines = fileList.split('\n');
		return {
			content: `Directory: ${filePath}\n\n${fileList}`,
			startLine: 1,
			endLine: lines.length,
			totalLines: lines.length,
		};
	}

	if (ctx.isImageFile(fullPath)) {
		const imageContent = await ctx.readImageAsBase64(fullPath);
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

	if (ctx.isOfficeFile(fullPath)) {
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

	let content: string | undefined;
	let lines: string[];
	let totalLines: number;
	const fileSizeBytes = stats.size;
	const FILE_SIZE_LIMIT = 256 * 1024 * 1024;

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
		const end = Math.min(totalLines, Math.min(actualEndLine, start + lines.length - 1));
		const numberedLines = lines.map((line, index) =>
			formatLineWithHash(start + index, line),
		);
		const sizeInfo = `[File: ${Math.round(fileSizeBytes / 1024 / 1024)}MB, ${totalLines} lines total. Showing lines ${start}-${end}. Use startLine/endLine to read other sections.]`;
		return {
			content: `${sizeInfo}\n${numberedLines.join('\n')}`,
			startLine: start,
			endLine: end,
			totalLines,
		};
	}

	content = await readFileWithEncoding(fullPath);
	lines = content.split('\n');
	totalLines = lines.length;
	const actualStartLine = startLine ?? 1;
	const actualEndLine = endLine ?? totalLines;
	if (actualStartLine < 1) {
		throw new Error('Start line must be greater than 0');
	}
	if (actualEndLine < actualStartLine) {
		throw new Error('End line must be greater than or equal to start line');
	}
	const start = Math.min(actualStartLine, totalLines);
	const end = Math.min(totalLines, actualEndLine);
	const selectedLines = lines.slice(start - 1, end);
	const numberedLines = selectedLines.map((line, index) =>
		formatLineWithHash(start + index, line),
	);

	let partialContent = numberedLines.join('\n');
	try {
		const symbols = await parseFileSymbols(fullPath, content, ctx.basePath);
		const symbolInfo = ctx.extractRelevantSymbols(symbols, start, end, totalLines);
		if (symbolInfo) {
			partialContent += symbolInfo;
		}
	} catch {
		// optional
	}

	const notebookInfo = ctx.getNotebookEntries(filePath);
	if (notebookInfo) {
		partialContent += notebookInfo;
	}

	return {
		content: partialContent,
		startLine: start,
		endLine: end,
		totalLines,
	};
}
