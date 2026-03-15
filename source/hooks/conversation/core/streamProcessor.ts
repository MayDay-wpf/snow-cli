import type {ChatMessage} from '../../../api/chat.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import type {MCPTool} from '../../../utils/execution/mcpToolsManager.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import {createStreamGenerator} from './streamFactory.js';
import type {
	ConversationHandlerOptions,
	ConversationUsage,
	StreamRoundResult,
	TokenEncoder,
} from './conversationTypes.js';

const TOKEN_UPDATE_INTERVAL = 100;
const STREAM_FLUSH_INTERVAL = 80;
const THINKING_TAG_PATTERN = /\s*<\/?think(?:ing)?>\s*/gi;
const LIST_ITEM_PATTERN = /^\s*\d+[.)]\s|^\s*[-*+]\s/;
const LIST_CONTINUATION_PATTERN = /^\s{2,}/;

function cleanThinkingContent(content: string): string {
	return content.replace(THINKING_TAG_PATTERN, '');
}

function isTableRow(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2;
}

function isListItemLine(line: string): boolean {
	return LIST_ITEM_PATTERN.test(line);
}

export async function processStreamRound(ctx: {
	config: any;
	model: string;
	conversationMessages: ChatMessage[];
	activeTools: MCPTool[];
	controller: AbortController;
	encoder: TokenEncoder;
	setStreamTokenCount: React.Dispatch<React.SetStateAction<number>>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setIsReasoning?: React.Dispatch<React.SetStateAction<boolean>>;
	setRetryStatus?: React.Dispatch<React.SetStateAction<any>>;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	options: ConversationHandlerOptions;
}): Promise<StreamRoundResult> {
	const {
		config,
		model,
		conversationMessages,
		activeTools,
		controller,
		encoder,
		setStreamTokenCount,
		setMessages,
		setIsReasoning,
		setRetryStatus,
		setContextUsage,
		options,
	} = ctx;

	let streamedContent = '';
	let receivedToolCalls: StreamRoundResult['receivedToolCalls'];
	let receivedReasoning: StreamRoundResult['receivedReasoning'];
	let receivedThinking: StreamRoundResult['receivedThinking'];
	let receivedReasoningContent: string | undefined;
	let hasStartedReasoning = false;
	let currentTokenCount = 0;
	let lastTokenUpdateTime = 0;
	let chunkCount = 0;
	let roundUsage: ConversationUsage | null = null;

	const streamingEnabled = config.streamingDisplay !== false;

	let thinkingLineBuffer = '';
	let contentLineBuffer = '';
	let isFirstStreamLine = true;
	let hasReceivedContentChunk = false;
	let hasStartedContent = false;
	let hasStreamedLines = false;

	let inCodeBlock = false;
	let codeBlockBuffer = '';
	let tableBuffer = '';
	let listBuffer = '';
	const pendingStreamLines: Message[] = [];
	let lastFlushTime = 0;

	const flushStreamLines = () => {
		if (pendingStreamLines.length === 0) {
			return;
		}

		const batch = [...pendingStreamLines];
		pendingStreamLines.length = 0;
		setMessages(prev => [...prev, ...batch]);
		lastFlushTime = Date.now();
	};

	const emitStreamLine = (content: string, isThinking: boolean) => {
		if (!streamingEnabled) {
			return;
		}

		const isFirst = isFirstStreamLine;
		const isFirstContent = !isThinking && !hasStartedContent;
		if (isFirst) {
			isFirstStreamLine = false;
		}
		if (isFirstContent) {
			hasStartedContent = true;
		}
		hasStreamedLines = true;
		pendingStreamLines.push({
			role: 'assistant',
			content,
			streamingLine: true,
			isThinkingLine: isThinking,
			isFirstStreamLine: isFirst,
			isFirstContentLine: isFirstContent,
		});

		const now = Date.now();
		if (now - lastFlushTime >= STREAM_FLUSH_INTERVAL) {
			flushStreamLines();
		}
	};

	const flushThinkingBufferToStream = () => {
		if (hasReceivedContentChunk || !thinkingLineBuffer) {
			thinkingLineBuffer = '';
			return;
		}

		const cleaned = cleanThinkingContent(thinkingLineBuffer);
		if (cleaned.trim()) {
			emitStreamLine(cleaned, true);
		}
		thinkingLineBuffer = '';
	};

	const flushListBuffer = () => {
		if (!listBuffer) {
			return;
		}
		emitStreamLine(listBuffer.trimEnd(), false);
		listBuffer = '';
	};

	const flushTableBuffer = () => {
		if (!tableBuffer) {
			return;
		}
		emitStreamLine(tableBuffer.trimEnd(), false);
		tableBuffer = '';
	};

	const processContentLine = (line: string) => {
		if (inCodeBlock) {
			codeBlockBuffer += line + '\n';
			if (line.trimStart().startsWith('```')) {
				inCodeBlock = false;
				emitStreamLine(codeBlockBuffer.trimEnd(), false);
				codeBlockBuffer = '';
			}
			return;
		}

		if (line.trimStart().startsWith('```')) {
			flushTableBuffer();
			flushListBuffer();
			inCodeBlock = true;
			codeBlockBuffer = line + '\n';
			return;
		}

		if (isTableRow(line)) {
			flushListBuffer();
			tableBuffer += line + '\n';
			return;
		}

		flushTableBuffer();

		if (isListItemLine(line)) {
			listBuffer += line + '\n';
			return;
		}

		if (listBuffer && (line.trim() === '' || LIST_CONTINUATION_PATTERN.test(line))) {
			listBuffer += line + '\n';
			return;
		}

		flushListBuffer();
		emitStreamLine(line, false);
	};

	const countTokens = (text: string) => {
		try {
			const deltaTokens = encoder.encode(text);
			currentTokenCount += deltaTokens.length;
			const now = Date.now();
			if (now - lastTokenUpdateTime >= TOKEN_UPDATE_INTERVAL) {
				setStreamTokenCount(currentTokenCount);
				lastTokenUpdateTime = now;
			}
		} catch {
			// Ignore encoding errors
		}
	};

	const currentSession = sessionManager.getCurrentSession();
	const onRetry = (error: Error, attempt: number, nextDelay: number) => {
		if (setRetryStatus) {
			setRetryStatus({
				isRetrying: true,
				attempt,
				nextDelay,
				errorMessage: error.message,
			});
		}
	};

	const streamGenerator = createStreamGenerator({
		config,
		model,
		conversationMessages,
		activeTools,
		sessionId: currentSession?.id,
		useBasicModel: options.useBasicModel,
		planMode: options.planMode,
		vulnerabilityHuntingMode: options.vulnerabilityHuntingMode,
		toolSearchDisabled: options.toolSearchDisabled,
		signal: controller.signal,
		onRetry,
	});

	for await (const chunk of streamGenerator) {
		if (controller.signal.aborted) {
			break;
		}

		chunkCount++;
		if (setRetryStatus && chunkCount === 1) {
			setTimeout(() => setRetryStatus(null), 500);
		}

		if (chunk.type === 'reasoning_started') {
			if (!hasReceivedContentChunk) {
				setIsReasoning?.(true);
			}
			continue;
		}

		if (chunk.type === 'reasoning_delta' && chunk.delta) {
			if (!hasStartedReasoning) {
				hasStartedReasoning = true;
				if (!hasReceivedContentChunk) {
					setIsReasoning?.(true);
				}
			}
			countTokens(chunk.delta);

			if (hasReceivedContentChunk) {
				continue;
			}

			thinkingLineBuffer += chunk.delta;
			const thinkLines = thinkingLineBuffer.split('\n');
			for (let i = 0; i < thinkLines.length - 1; i++) {
				const cleaned = cleanThinkingContent(thinkLines[i] ?? '');
				if (cleaned || hasStreamedLines) {
					emitStreamLine(cleaned, true);
				}
			}
			thinkingLineBuffer = thinkLines[thinkLines.length - 1] ?? '';
			continue;
		}

		if (chunk.type === 'content' && chunk.content) {
			if (!hasReceivedContentChunk) {
				hasReceivedContentChunk = true;
				flushThinkingBufferToStream();
			}
			setIsReasoning?.(false);
			streamedContent += chunk.content;
			countTokens(chunk.content);
			contentLineBuffer += chunk.content;
			const contentLines = contentLineBuffer.split('\n');
			for (let i = 0; i < contentLines.length - 1; i++) {
				processContentLine(contentLines[i] ?? '');
			}
			contentLineBuffer = contentLines[contentLines.length - 1] ?? '';
			continue;
		}

		if (chunk.type === 'tool_call_delta' && chunk.delta) {
			setIsReasoning?.(false);
			countTokens(chunk.delta);
			continue;
		}

		if (chunk.type === 'tool_calls' && chunk.tool_calls) {
			receivedToolCalls = chunk.tool_calls;
			continue;
		}

		if (chunk.type === 'reasoning_data' && chunk.reasoning) {
			receivedReasoning = chunk.reasoning;
			continue;
		}

		if (chunk.type === 'done') {
			if ((chunk as any).thinking) {
				receivedThinking = (chunk as any).thinking;
			}
			if ((chunk as any).reasoning_content) {
				receivedReasoningContent = (chunk as any).reasoning_content;
			}
			continue;
		}

		if (chunk.type === 'usage' && chunk.usage) {
			setContextUsage(chunk.usage);
			roundUsage = {
				prompt_tokens: chunk.usage.prompt_tokens || 0,
				completion_tokens: chunk.usage.completion_tokens || 0,
				total_tokens: chunk.usage.total_tokens || 0,
				cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens,
				cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
				cached_tokens: chunk.usage.cached_tokens,
			};
		}
	}

	if (!hasReceivedContentChunk) {
		flushThinkingBufferToStream();
	} else {
		thinkingLineBuffer = '';
	}
	if (contentLineBuffer.trim()) {
		processContentLine(contentLineBuffer);
	}
	if (codeBlockBuffer) {
		emitStreamLine(codeBlockBuffer.trimEnd(), false);
	}
	flushTableBuffer();
	flushListBuffer();
	flushStreamLines();

	return {
		streamedContent,
		receivedToolCalls,
		receivedReasoning,
		receivedThinking,
		receivedReasoningContent,
		roundUsage,
		hasStreamedLines,
	};
}
