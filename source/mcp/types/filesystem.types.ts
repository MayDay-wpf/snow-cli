/**
 * Type definitions for Filesystem MCP Service
 */

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
