/**
 * Shared API types for all AI providers
 */

export interface ImageContent {
	type: 'image';
	data: string; // Base64 编码的图片数据
	mimeType: string; // 图片 MIME 类型
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
	images?: ImageContent[]; // 图片内容
	subAgentInternal?: boolean; // Mark internal sub-agent messages (filtered from API requests)
	reasoning?: {
		// Reasoning data for Responses API caching
		summary?: Array<{type: 'summary_text'; text: string}>;
		content?: any;
		encrypted_content?: string;
	};
	// Anthropic Extended Thinking - complete block with signature
	thinking?: {
		type: 'thinking';
		thinking: string; // Accumulated thinking text
		signature?: string; // Required signature for verification
	};
}

export interface ChatCompletionTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, any>;
	};
}

export interface UsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number; // Tokens used to create cache (Anthropic)
	cache_read_input_tokens?: number; // Tokens read from cache (Anthropic)
	cached_tokens?: number; // Cached tokens from prompt_tokens_details (OpenAI)
}
