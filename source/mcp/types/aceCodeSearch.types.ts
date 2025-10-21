/**
 * Type definitions for ACE Code Search Service
 */

/**
 * Code symbol types
 */
export type SymbolType =
	| 'function'
	| 'class'
	| 'method'
	| 'variable'
	| 'constant'
	| 'interface'
	| 'type'
	| 'enum'
	| 'import'
	| 'export';

/**
 * Code symbol information
 */
export interface CodeSymbol {
	name: string;
	type: SymbolType;
	filePath: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	signature?: string;
	scope?: string;
	language: string;
	context?: string; // Surrounding code context
}

/**
 * Code reference types
 */
export type ReferenceType = 'definition' | 'usage' | 'import' | 'type';

/**
 * Code reference information
 */
export interface CodeReference {
	symbol: string;
	filePath: string;
	line: number;
	column: number;
	context: string;
	referenceType: ReferenceType;
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult {
	query: string;
	symbols: CodeSymbol[];
	references: CodeReference[];
	totalResults: number;
	searchTime: number;
}

/**
 * AST node structure
 */
export interface ASTNode {
	type: string;
	name?: string;
	line: number;
	column: number;
	endLine?: number;
	endColumn?: number;
	children?: ASTNode[];
}

/**
 * Text search result
 */
export interface TextSearchResult {
	filePath: string;
	line: number;
	column: number;
	content: string;
}

/**
 * Language configuration
 */
export interface LanguageConfig {
	extensions: string[];
	parser: string;
	symbolPatterns: {
		function: RegExp;
		class: RegExp;
		variable?: RegExp;
		import?: RegExp;
		export?: RegExp;
	};
}

/**
 * Index statistics
 */
export interface IndexStats {
	totalFiles: number;
	totalSymbols: number;
	languageBreakdown: Record<string, number>;
	cacheAge: number;
}
