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
	subAgentContent?: boolean; // Persisted sub-agent thinking/content replay message
	subAgent?: {
		agentId: string;
		agentName: string;
		isComplete?: boolean;
	};
	// IDE editor context (VSCode workspace, active file, cursor position, selected code)
	// This field is stored separately and only used when sending to AI, not displayed in UI
	editorContext?: {
		workspaceFolder?: string;
		activeFile?: string;
		cursorPosition?: {line: number; character: number};
		selectedText?: string;
	};
	reasoning?: {
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
	// OpenRouter 等兼容 API 的 reasoning_details 数组形态：
	// reasoning.text / reasoning.summary 为可读子块，reasoning.encrypted 为加密子块（忽略）
	reasoning_details?: Array<{
		type?: string; // 'reasoning.text' | 'reasoning.summary' | 'reasoning.encrypted'
		text?: string; // reasoning.text 子块的可读文本
		summary?: string; // reasoning.summary 子块的可读摘要
		data?: string; // reasoning.encrypted 子块的加密载荷（忽略）
		[index: string]: unknown;
	}>;
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
