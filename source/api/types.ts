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
	messageStatus?: 'pending' | 'success' | 'error';
	tool_call_id?: string;
	tool_calls?: ToolCall[];
	images?: ImageContent[]; // 图片内容
	subAgentInternal?: boolean; // Mark internal sub-agent messages (filtered from API requests)
	// IDE editor context (VSCode workspace, active file, cursor position, selected code)
	// This field is stored separately and only used when sending to AI, not displayed in UI
	editorContext?: {
		workspaceFolder?: string;
		activeFile?: string;
		cursorPosition?: {line: number; character: number};
		selectedText?: string;
	};
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
	// DeepSeek R1 Reasoning Content - complete reasoning chain
	reasoning_content?: string; // Complete reasoning content from DeepSeek R1 models
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
