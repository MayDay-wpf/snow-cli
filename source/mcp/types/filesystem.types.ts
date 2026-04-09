/**
 * Type definitions for Filesystem MCP Service
 */

import type {Diagnostic} from '../../utils/ui/vscodeConnection.js';

/**
 * MCP Content Types - supports multimodal content
 */
export type MCPContentType = 'text' | 'image' | 'document';

/**
 * Text content block
 */
export interface TextContent {
	type: 'text';
	text: string;
}

/**
 * Image content block (base64 encoded)
 */
export interface ImageContent {
	type: 'image';
	data: string; // base64 encoded image data
	mimeType: string; // e.g., 'image/png', 'image/jpeg'
}

/**
 * Document content block (for Office files like PDF, Word, Excel, PPT)
 */
export interface DocumentContent {
	type: 'document';
	text: string; // Extracted text content
	fileType: 'pdf' | 'word' | 'excel' | 'powerpoint';
	metadata?: {
		pages?: number; // For PDF
		sheets?: string[]; // For Excel
		slides?: number; // For PowerPoint
		[key: string]: unknown;
	};
}

/**
 * Multimodal content - array of text, image, and document blocks
 */
export type MultimodalContent = Array<
	TextContent | ImageContent | DocumentContent
>;

/**
 * Supported image MIME types
 */
export const IMAGE_MIME_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.svg': 'image/svg+xml',
};

/**
 * Supported Office document types
 */
export const OFFICE_FILE_TYPES: Record<
	string,
	'pdf' | 'word' | 'excel' | 'powerpoint'
> = {
	'.pdf': 'pdf',
	'.docx': 'word',
	'.doc': 'word',
	'.xlsx': 'excel',
	'.xls': 'excel',
	'.pptx': 'powerpoint',
	'.ppt': 'powerpoint',
};

/**
 * Structure analysis result for code validation
 */
export interface StructureAnalysis {
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
 * File read configuration
 */
export interface FileReadConfig {
	path: string;
	startLine?: number;
	endLine?: number;
}

/**
 * Single file read result
 */
export interface SingleFileReadResult {
	content: string | MultimodalContent; // Can be text or multimodal
	startLine?: number; // Only for text files
	endLine?: number; // Only for text files
	totalLines?: number; // Only for text files
	isImage?: boolean; // Flag to indicate image content
	isDocument?: boolean; // Flag to indicate Office document content
	fileType?: 'pdf' | 'word' | 'excel' | 'powerpoint'; // Document type
	mimeType?: string; // MIME type for images
}

/**
 * Multiple files read result
 */
export interface MultipleFilesReadResult {
	content: string | MultimodalContent; // Can be text or multimodal
	files: Array<{
		path: string;
		startLine?: number;
		endLine?: number;
		totalLines?: number;
		isImage?: boolean;
		isDocument?: boolean;
		fileType?: 'pdf' | 'word' | 'excel' | 'powerpoint';
		mimeType?: string;
	}>;
	totalFiles: number;
}

/**
 * Hashline edit operation types
 */
export type HashlineOperationType = 'replace' | 'insert_after' | 'delete';

/**
 * A single hashline edit operation.
 * Anchors use the format "lineNum:hash" (e.g. "42:a3").
 */
export interface HashlineOperation {
	type: HashlineOperationType;
	/** Start anchor – required for all operation types */
	startAnchor: string;
	/** End anchor – for range replace/delete. Omit for single-line ops or insert_after. */
	endAnchor?: string;
	/** New content – required for replace and insert_after, ignored for delete */
	content?: string;
}

/**
 * Edit by hashline configuration (for batch mode)
 */
export interface EditByHashlineConfig {
	path: string;
	operations: HashlineOperation[];
}

/**
 * Hashline edit single file result
 */
export interface EditByHashlineSingleResult extends SingleFileEditResult {
	replacedContent: string;
	operationsSummary: string;
}

/**
 * Single file edit result (common fields)
 */
export interface SingleFileEditResult {
	message: string;
	filePath?: string; // File path for DiffViewer display on Resume/re-render
	oldContent: string;
	newContent: string;
	contextStartLine: number;
	contextEndLine: number;
	totalLines: number;
	structureAnalysis?: StructureAnalysis;
	diagnostics?: Diagnostic[];
}

/**
 * Batch operation result item (generic)
 */
export interface BatchResultItem {
	path: string;
	success: boolean;
	error?: string;
}

/**
 * Edit by hashline batch result item
 */
export type EditByHashlineBatchResultItem = BatchResultItem &
	Partial<EditByHashlineSingleResult>;

/**
 * Batch operation result (generic)
 */
export interface BatchOperationResult<T extends BatchResultItem> {
	message: string;
	results: T[];
	totalFiles: number;
	successCount: number;
	failureCount: number;
}

/**
 * Edit by hashline return type
 */
export type EditByHashlineResult =
	| EditByHashlineSingleResult
	| BatchOperationResult<EditByHashlineBatchResultItem>;
