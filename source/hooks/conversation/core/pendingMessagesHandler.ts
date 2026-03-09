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
			setConversationContext(
				updatedSession.id,
				updatedSession.messages.length,
			);
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
