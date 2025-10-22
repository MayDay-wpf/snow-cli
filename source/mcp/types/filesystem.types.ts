/**
 * Type definitions for Filesystem MCP Service
 */

import type {Diagnostic} from '../../utils/vscodeConnection.js';

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
 * Match candidate for fuzzy search
 */
export interface MatchCandidate {
	startLine: number;
	endLine: number;
	similarity: number;
	preview: string;
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
 * Edit by search configuration
 */
export interface EditBySearchConfig {
	path: string;
	searchContent: string;
	replaceContent: string;
	occurrence?: number;
}

/**
 * Edit by line range configuration
 */
export interface EditByLineConfig {
	path: string;
	startLine: number;
	endLine: number;
	newContent: string;
}

/**
 * Single file edit result (common fields)
 */
export interface SingleFileEditResult {
	message: string;
	oldContent: string;
	newContent: string;
	contextStartLine: number;
	contextEndLine: number;
	totalLines: number;
	structureAnalysis?: StructureAnalysis;
	diagnostics?: Diagnostic[];
}

/**
 * Edit by search single file result
 */
export interface EditBySearchSingleResult extends SingleFileEditResult {
	replacedContent: string;
	matchLocation: {startLine: number; endLine: number};
}

/**
 * Edit by line single file result
 */
export interface EditByLineSingleResult extends SingleFileEditResult {
	replacedLines: string;
	linesModified: number;
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
 * Edit by search batch result item
 */
export type EditBySearchBatchResultItem = BatchResultItem &
	Partial<EditBySearchSingleResult>;

/**
 * Edit by line batch result item
 */
export type EditByLineBatchResultItem = BatchResultItem &
	Partial<EditByLineSingleResult>;

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
 * Edit by search return type
 */
export type EditBySearchResult =
	| EditBySearchSingleResult
	| BatchOperationResult<EditBySearchBatchResultItem>;

/**
 * Edit by line return type
 */
export type EditByLineResult =
	| EditByLineSingleResult
	| BatchOperationResult<EditByLineBatchResultItem>;
