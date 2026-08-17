/**
 * Type definitions for Web Search Service
 */

/**
 * Search result item
 */
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	displayUrl: string;
}

/**
 * Search response
 */
export interface SearchResponse {
	query: string;
	results: SearchResult[];
	totalResults: number;
	/** 被屏蔽规则过滤掉的结果数量。 */
	blockedCount?: number;
	/** 屏蔽比例达到阈值时回传的被屏蔽结果明细。 */
	blockedResults?: SearchResult[];
	/** 触发屏蔽的规则（正则字符串）。 */
	blockedPatterns?: string[];
	/** 给 AI 的屏蔽说明，解释为何返回了被屏蔽明细。 */
	blockNote?: string;
}

/**
 * Web page content
 */
export interface WebPageContent {
	url: string;
	title: string;
	content:
		| string
		| Array<
				| {type: 'text'; text: string}
				| {type: 'image'; data: string; mimeType: string}
		  >;
	textLength: number;
	contentPreview: string;
}
