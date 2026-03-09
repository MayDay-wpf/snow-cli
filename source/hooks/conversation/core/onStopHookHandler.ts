import type {ChatMessage} from '../../../api/chat.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import {unifiedHooksExecutor} from '../../../utils/execution/unifiedHooksExecutor.js';

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

		if (!hookResult.results || hookResult.results.length === 0) {
			return {shouldContinue: false};
		}

		let shouldContinue = false;

		for (const result of hookResult.results) {
			if (result.type === 'command' && !result.success) {
				if (result.exitCode === 1) {
					console.log(
						'[WARN] onStop hook warning:',
						result.error || result.output || '',
					);
				} else if (result.exitCode >= 2) {
					const errorMessage: ChatMessage = {
						role: 'user',
						content: result.error || result.output || '未知错误',
					};
					conversationMessages.push(errorMessage);
					await saveMessage(errorMessage);
					setMessages(prev => [
						...prev,
						{
							role: 'user',
							content: errorMessage.content,
							streaming: false,
						},
					]);
					shouldContinue = true;
				}
			} else if (result.type === 'prompt' && result.response) {
				if (result.response.ask === 'ai' && result.response.continue) {
					const promptMessage: ChatMessage = {
						role: 'user',
						content: result.response.message,
					};
					conversationMessages.push(promptMessage);
					await saveMessage(promptMessage);
					setMessages(prev => [
						...prev,
						{
							role: 'user',
							content: promptMessage.content,
							streaming: false,
						},
					]);
					shouldContinue = true;
				} else if (
					result.response.ask === 'user' &&
					!result.response.continue
				) {
					setMessages(prev => [
						...prev,
						{
							role: 'assistant',
							content: result.response!.message,
							streaming: false,
						},
					]);
				}
			}
		}

		return {shouldContinue};
	} catch (error) {
		console.error('onStop hook execution failed:', error);
		return {shouldContinue: false};
	}
}
