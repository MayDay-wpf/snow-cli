import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {CompressionStatus} from '../../../ui/components/compression/CompressionStatus.js';
import {
	getOpenAiConfig,
	DEFAULT_AUTO_COMPRESS_THRESHOLD,
} from '../../../utils/config/apiConfig.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../../utils/core/autoCompress.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';

export type AutoCompressOptions = {
	getCurrentContextPercentage?: () => number;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	clearSavedMessages?: () => void;
	setRemountKey?: React.Dispatch<React.SetStateAction<number>>;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	setSnapshotFileCount?: React.Dispatch<
		React.SetStateAction<Map<number, number>>
	>;
	setIsStreaming?: React.Dispatch<React.SetStateAction<boolean>>;
	freeEncoder: () => void;
	compressingLabel?: string;
	onCompressionStatus?: (status: CompressionStatus | null) => void;
	setIsAutoCompressing?: (value: boolean) => void;
};

export type AutoCompressResult = {
	compressed: boolean;
	hookFailed: boolean;
	hookErrorDetails?: any;
	updatedConversationMessages?: any[];
	accumulatedUsage?: any;
};

/**
 * Check if auto-compression is needed and perform it.
 * This logic is reused in two places: after tool execution and before pending messages.
 */
export async function handleAutoCompression(
	options: AutoCompressOptions,
): Promise<AutoCompressResult> {
	const config = getOpenAiConfig();

	if (
		config.enableAutoCompress === false ||
		!options.getCurrentContextPercentage ||
		!shouldAutoCompress(
			options.getCurrentContextPercentage(),
			config.autoCompressThreshold ?? DEFAULT_AUTO_COMPRESS_THRESHOLD,
		)
	) {
		return {compressed: false, hookFailed: false};
	}

	options.setIsAutoCompressing?.(true);

	try {
		const compressingMessage: Message = {
			role: 'assistant',
			content: options.compressingLabel || '✵ Auto-compressing context...',
			streaming: false,
		};
		options.setMessages(prev => [...prev, compressingMessage]);

		const session = sessionManager.getCurrentSession();

		// Set up status callback for UI display
		const onStatusUpdate = (status: CompressionStatus) => {
			options.onCompressionStatus?.(status);
		};

		const compressionResult = await performAutoCompression(
			session?.id,
			onStatusUpdate,
		);

		// Clear status after completion
		options.onCompressionStatus?.(null);

		// Check if beforeCompress hook failed
		if (compressionResult && (compressionResult as any).hookFailed) {
			options.setIsAutoCompressing?.(false);
			return {
				compressed: false,
				hookFailed: true,
				hookErrorDetails: (compressionResult as any).hookErrorDetails,
			};
		}

		if (compressionResult && options.clearSavedMessages) {
			options.clearSavedMessages();
			options.setMessages(compressionResult.uiMessages);
			if (options.setRemountKey) {
				options.setRemountKey(prev => prev + 1);
			}

			let accumulatedUsage: any;
			if (compressionResult.usage) {
				options.setContextUsage(compressionResult.usage);
				accumulatedUsage = compressionResult.usage;
			}

			if (options.setSnapshotFileCount) {
				options.setSnapshotFileCount(new Map());
			}

			// Rebuild conversation messages from new session
			const updatedSession = sessionManager.getCurrentSession();
			const updatedConversationMessages: any[] = [];
			if (updatedSession && updatedSession.messages.length > 0) {
				updatedConversationMessages.push(...updatedSession.messages);
			}

			options.setIsAutoCompressing?.(false);
			return {
				compressed: true,
				hookFailed: false,
				updatedConversationMessages,
				accumulatedUsage,
			};
		}
	} catch (error) {
		options.onCompressionStatus?.({
			step: 'failed',
			message: error instanceof Error ? error.message : 'Unknown error',
		});
	}

	options.setIsAutoCompressing?.(false);
	return {compressed: false, hookFailed: false};
}
