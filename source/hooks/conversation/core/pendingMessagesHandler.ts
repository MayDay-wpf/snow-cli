import type {Message} from '../../../ui/components/chat/MessageList.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {handleAutoCompression, type AutoCompressOptions} from './autoCompressHandler.js';

export type PendingMessagesOptions = {
	getPendingMessages?: () => Array<{
		text: string;
		images?: Array<{data: string; mimeType: string}>;
	}>;
	clearPendingMessages?: () => void;
	conversationMessages: any[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	autoCompressOptions: AutoCompressOptions;
};

export type PendingMessagesResult = {
	hasPending: boolean;
	hookFailed: boolean;
	hookErrorDetails?: any;
	updatedConversationMessages?: any[];
	accumulatedUsage?: any;
};

type BasicConversationMessage = {
	role?: string;
	tool_call_id?: string;
	tool_calls?: Array<{id: string}>;
};

/**
 * PendingMessage 安全发送信号：
 * 仅当当前会话尾部不存在未闭合的 tool_call 轮次时返回 true。
 */
export function isPendingSendTimingReady(
	messages: BasicConversationMessage[],
): boolean {
	const resolvedToolCallIds = new Set<string>();

	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m) continue;

		if (m.role === 'tool' && m.tool_call_id) {
			resolvedToolCallIds.add(m.tool_call_id);
			continue;
		}

		if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
			const hasUnresolvedCall = m.tool_calls.some(
				tc => !resolvedToolCallIds.has(tc.id),
			);
			if (hasUnresolvedCall) {
				return false;
			}
		}
	}

	return true;
}

/**
 * 等待 PendingMessage 发送时机（与 handlePendingMessages 一致的信号语义）。
 * - 已就绪：立即返回
 * - 未就绪：订阅消息变更，直到就绪 / 超时 / 中断
 */
export async function waitForPendingSendSignal(options?: {
	abortSignal?: AbortSignal;
	timeoutMs?: number;
}): Promise<void> {
	const {abortSignal, timeoutMs = 3000} = options || {};
	const initialSession = sessionManager.getCurrentSession();
	if (!initialSession) return;
	if (isPendingSendTimingReady(initialSession.messages as BasicConversationMessage[])) {
		return;
	}

	await new Promise<void>(resolve => {
		let finished = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let unsubscribe: (() => void) | undefined;

		const cleanup = () => {
			if (finished) return;
			finished = true;
			if (timeout) clearTimeout(timeout);
			if (unsubscribe) unsubscribe();
			resolve();
		};

		const tryResolve = () => {
			if (abortSignal?.aborted) {
				cleanup();
				return;
			}
			const session = sessionManager.getCurrentSession();
			if (!session) {
				cleanup();
				return;
			}
			if (isPendingSendTimingReady(session.messages as BasicConversationMessage[])) {
				cleanup();
			}
		};

		unsubscribe = sessionManager.onMessagesChanged(tryResolve);
		timeout = setTimeout(cleanup, timeoutMs);
		tryResolve();
	});
}

/**
 * Handle pending user messages that arrived during tool execution.
 * Also performs auto-compression before injecting if needed.
 */
export async function handlePendingMessages(
	options: PendingMessagesOptions,
): Promise<PendingMessagesResult> {
	const {
		getPendingMessages,
		clearPendingMessages,
		conversationMessages,
		saveMessage,
		setMessages,
	} = options;

	if (!getPendingMessages || !clearPendingMessages) {
		return {hasPending: false, hookFailed: false};
	}

	const pendingMessages = getPendingMessages();
	if (pendingMessages.length === 0) {
		return {hasPending: false, hookFailed: false};
	}

	// Auto-compress before inserting pending messages if needed
	const compressResult = await handleAutoCompression({
		...options.autoCompressOptions,
		compressingLabel:
			'✵ Auto-compressing context before processing pending messages...',
	});

	if (compressResult.hookFailed) {
		return {
			hasPending: true,
			hookFailed: true,
			hookErrorDetails: compressResult.hookErrorDetails,
		};
	}

	let activeConversationMessages = conversationMessages;
	let accumulatedUsage = compressResult.accumulatedUsage;

	if (compressResult.compressed && compressResult.updatedConversationMessages) {
		// Replace conversation messages with post-compression messages
		conversationMessages.length = 0;
		conversationMessages.push(...compressResult.updatedConversationMessages);
		activeConversationMessages = conversationMessages;
	}

	clearPendingMessages();

	const combinedMessage = pendingMessages.map(m => m.text).join('\n\n');

	const allPendingImages = pendingMessages
		.flatMap(m => m.images || [])
		.map(img => ({
			type: 'image' as const,
			data: img.data,
			mimeType: img.mimeType,
		}));

	// Add user message to UI
	const userMessage: Message = {
		role: 'user',
		content: combinedMessage,
		images: allPendingImages.length > 0 ? allPendingImages : undefined,
	};
	setMessages(prev => [...prev, userMessage]);

	// Add to conversation history
	activeConversationMessages.push({
		role: 'user',
		content: combinedMessage,
		images: allPendingImages.length > 0 ? allPendingImages : undefined,
	});

	// Save and set conversation context
	try {
		await saveMessage({
			role: 'user',
			content: combinedMessage,
			images: allPendingImages.length > 0 ? allPendingImages : undefined,
		});

		const {setConversationContext} = await import(
			'../../../utils/codebase/conversationContext.js'
		);
		const updatedSession = sessionManager.getCurrentSession();
		if (updatedSession) {
			const {convertSessionMessagesToUI} = await import(
				'../../../utils/session/sessionConverter.js'
			);
			const uiMessages = convertSessionMessagesToUI(
				updatedSession.messages,
			);
			setConversationContext(updatedSession.id, uiMessages.length);
		}
	} catch (error) {
		console.error('Failed to save pending user message:', error);
	}

	return {
		hasPending: true,
		hookFailed: false,
		updatedConversationMessages: compressResult.compressed
			? compressResult.updatedConversationMessages
			: undefined,
		accumulatedUsage,
	};
}
