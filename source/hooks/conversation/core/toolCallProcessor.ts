import type {ChatMessage} from '../../../api/chat.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {ToolCall} from '../../../utils/execution/toolExecutor.js';
import {formatToolCallMessage} from '../../../utils/ui/messageFormatter.js';
import {isToolNeedTwoStepDisplay} from '../../../utils/config/toolDisplayConfig.js';
import {extractThinkingContent} from '../utils/thinkingExtractor.js';

export type ProcessToolCallsOptions = {
	receivedToolCalls: ToolCall[];
	streamedContent: string;
	receivedReasoning: any;
	receivedThinking:
		| {type: 'thinking'; thinking: string; signature?: string}
		| undefined;
	receivedReasoningContent: string | undefined;
	conversationMessages: any[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	extractThinkingContent: typeof extractThinkingContent;
};

export async function processToolCallsAfterStream(
	options: ProcessToolCallsOptions,
): Promise<{parallelGroupId: string | undefined}> {
	const {
		receivedToolCalls,
		streamedContent,
		receivedReasoning,
		receivedThinking,
		receivedReasoningContent,
		conversationMessages,
		saveMessage,
		setMessages,
	} = options;

	const sharedThoughtSignature = (
		receivedToolCalls.find(tc => (tc as any).thoughtSignature) as any
	)?.thoughtSignature as string | undefined;

	const assistantMessage: ChatMessage = {
		role: 'assistant',
		content: streamedContent || '',
		tool_calls: receivedToolCalls.map(tc => ({
			id: tc.id,
			type: 'function' as const,
			function: {
				name: tc.function.name,
				arguments: tc.function.arguments,
			},
			...(((tc as any).thoughtSignature || sharedThoughtSignature) && {
				thoughtSignature:
					(tc as any).thoughtSignature || sharedThoughtSignature,
			}),
		})),
		reasoning: receivedReasoning,
		thinking: receivedThinking,
		reasoning_content: receivedReasoningContent,
	} as any;

	conversationMessages.push(assistantMessage);

	try {
		await saveMessage(assistantMessage);
	} catch (error) {
		console.error('Failed to save assistant message:', error);
	}

	const thinkingContent = extractThinkingContent(
		receivedThinking,
		receivedReasoning,
		receivedReasoningContent,
	);

	if ((streamedContent && streamedContent.trim()) || thinkingContent) {
		setMessages(prev => [
			...prev,
			{
				role: 'assistant',
				content: streamedContent?.trim() || '',
				streaming: false,
				thinking: thinkingContent,
			},
		]);
	}

	const parallelGroupId =
		receivedToolCalls.length > 1
			? `parallel-${Date.now()}-${Math.random()}`
			: undefined;

	for (const toolCall of receivedToolCalls) {
		const toolDisplay = formatToolCallMessage(toolCall);
		let toolArgs;
		try {
			toolArgs = JSON.parse(toolCall.function.arguments);
		} catch (e) {
			toolArgs = {};
		}

		if (isToolNeedTwoStepDisplay(toolCall.function.name)) {
			setMessages(prev => [
				...prev,
				{
					role: 'assistant',
					content: `⚡ ${toolDisplay.toolName}`,
					streaming: false,
					toolCall: {
						name: toolCall.function.name,
						arguments: toolArgs,
					},
					toolDisplay,
					toolCallId: toolCall.id,
					toolPending: true,
					messageStatus: 'pending',
					parallelGroup: parallelGroupId,
				},
			]);
		}
	}

	return {parallelGroupId};
}
