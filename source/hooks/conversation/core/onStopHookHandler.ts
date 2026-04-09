import type {ChatMessage} from '../../../api/chat.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import {unifiedHooksExecutor} from '../../../utils/execution/unifiedHooksExecutor.js';
import {interpretHookResult} from '../../../utils/execution/hookResultInterpreter.js';

export type OnStopHookOptions = {
	conversationMessages: ChatMessage[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
};

export type OnStopHookResult = {
	shouldContinue: boolean;
};

/**
 * Execute onStop hooks after conversation completes (non-aborted).
 */
export async function handleOnStopHooks(
	options: OnStopHookOptions,
): Promise<OnStopHookResult> {
	const {conversationMessages, saveMessage, setMessages} = options;

	try {
		const hookResult = await unifiedHooksExecutor.executeHooks('onStop', {
			messages: conversationMessages,
		});
		const interpreted = interpretHookResult('onStop', hookResult);

		if (!interpreted.injectedMessages || interpreted.injectedMessages.length === 0) {
			return {shouldContinue: interpreted.shouldContinueConversation || false};
		}

		for (const injected of interpreted.injectedMessages) {
			const chatMsg: ChatMessage = {
				role: injected.role as 'user' | 'assistant',
				content: injected.content,
			};

			if (injected.role === 'user') {
				conversationMessages.push(chatMsg);
				await saveMessage(chatMsg);
			}

			setMessages(prev => [
				...prev,
				{
					role: injected.role,
					content: injected.content,
					streaming: false,
				},
			]);
		}

		return {shouldContinue: interpreted.shouldContinueConversation || false};
	} catch (error) {
		console.error('onStop hook execution failed:', error);
		return {shouldContinue: false};
	}
}
