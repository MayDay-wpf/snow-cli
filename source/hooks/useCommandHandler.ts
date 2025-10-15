import {useStdout} from 'ink';
import {useCallback} from 'react';
import type {Message} from '../ui/components/MessageList.js';
import {sessionManager} from '../utils/sessionManager.js';
import {compressContext} from '../utils/contextCompressor.js';
import {navigateTo} from './useGlobalNavigation.js';
import type {UsageInfo} from '../api/chat.js';
import {resetTerminal} from '../utils/terminal.js';

type CommandHandlerOptions = {
	messages: Message[];
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setRemountKey: React.Dispatch<React.SetStateAction<number>>;
	clearSavedMessages: () => void;
	setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
	setCompressionError: React.Dispatch<React.SetStateAction<string | null>>;
	setShowSessionPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setShowMcpInfo: React.Dispatch<React.SetStateAction<boolean>>;
	setShowMcpPanel: React.Dispatch<React.SetStateAction<boolean>>;
	setMcpPanelKey: React.Dispatch<React.SetStateAction<number>>;
	setYoloMode: React.Dispatch<React.SetStateAction<boolean>>;
	setContextUsage: React.Dispatch<React.SetStateAction<UsageInfo | null>>;
	setShouldIncludeSystemInfo: React.Dispatch<React.SetStateAction<boolean>>;
	setVscodeConnectionStatus: React.Dispatch<
		React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>
	>;
	processMessage: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => Promise<void>;
};

export function useCommandHandler(options: CommandHandlerOptions) {
	const {stdout} = useStdout();

	const handleCommandExecution = useCallback(
		async (commandName: string, result: any) => {
			// Handle /compact command
			if (
				commandName === 'compact' &&
				result.success &&
				result.action === 'compact'
			) {
				// Set compressing state (不添加命令面板消息)
				options.setIsCompressing(true);
				options.setCompressionError(null);

				try {
					// Convert messages to ChatMessage format for compression
					const chatMessages = options.messages
						.filter(msg => msg.role !== 'command')
						.map(msg => ({
							role: msg.role as 'system' | 'user' | 'assistant' | 'tool',
							content: msg.content,
							tool_call_id: msg.toolCallId,
						}));

					// Compress the context
					const result = await compressContext(chatMessages);

					// Replace all messages with a summary message (不包含 "Context Compressed" 标题)
					const summaryMessage: Message = {
						role: 'assistant',
						content: result.summary,
						streaming: false,
					};

					// Clear session and create new session with compressed summary
					sessionManager.clearCurrentSession();
					const newSession = await sessionManager.createNewSession();

					// Save the summary message to the new session so it's included in next API call
					if (newSession) {
						await sessionManager.addMessage({
							role: 'assistant',
							content: result.summary,
							timestamp: Date.now(),
						});
					}

					options.clearSavedMessages();
					options.setMessages([summaryMessage]);
					options.setRemountKey(prev => prev + 1);

					// Reset system info flag to include in next message
					options.setShouldIncludeSystemInfo(true);

					// Update token usage with compression result
					options.setContextUsage({
						prompt_tokens: result.usage.prompt_tokens,
						completion_tokens: result.usage.completion_tokens,
						total_tokens: result.usage.total_tokens,
					});
				} catch (error) {
					// Show error message
					const errorMsg =
						error instanceof Error
							? error.message
							: 'Unknown compression error';
					options.setCompressionError(errorMsg);

					const errorMessage: Message = {
						role: 'assistant',
						content: `**Compression Failed**\n\n${errorMsg}`,
						streaming: false,
					};
					options.setMessages(prev => [...prev, errorMessage]);
				} finally {
					options.setIsCompressing(false);
				}
				return;
			}

			// Handle /ide command
			if (commandName === 'ide') {
				if (result.success) {
					// If already connected, set status to connected immediately
					// Otherwise, set to connecting and wait for VSCode extension
					if (result.alreadyConnected) {
						options.setVscodeConnectionStatus('connected');
					} else {
						options.setVscodeConnectionStatus('connecting');
					}
					// Don't add command message to keep UI clean
				} else {
					options.setVscodeConnectionStatus('error');
				}
				return;
			}

			if (result.success && result.action === 'clear') {
				resetTerminal(stdout);
				// Clear current session and start new one
				sessionManager.clearCurrentSession();
				options.clearSavedMessages();
				options.setMessages([]);
				options.setRemountKey(prev => prev + 1);
				// Reset context usage (token statistics)
				options.setContextUsage(null);
				// Reset system info flag to include in next message
				options.setShouldIncludeSystemInfo(true);
				// Note: yoloMode is preserved via localStorage (lines 68-76, 104-111)
				// Note: VSCode connection is preserved and managed by vscodeConnection utility
				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages([commandMessage]);
			} else if (result.success && result.action === 'showSessionPanel') {
				options.setShowSessionPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showMcpInfo') {
				options.setShowMcpInfo(true);
				options.setMcpPanelKey(prev => prev + 1);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'showMcpPanel') {
				options.setShowMcpPanel(true);
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
			} else if (result.success && result.action === 'goHome') {
				navigateTo('welcome');
			} else if (result.success && result.action === 'toggleYolo') {
				// Toggle YOLO mode without adding command message
				options.setYoloMode(prev => !prev);
				// Don't add command message to keep UI clean
			} else if (
				result.success &&
				result.action === 'initProject' &&
				result.prompt
			) {
				// Add command execution feedback
				const commandMessage: Message = {
					role: 'command',
					content: '',
					commandName: commandName,
				};
				options.setMessages(prev => [...prev, commandMessage]);
				// Auto-send the prompt using basicModel, hide the prompt from UI
				options.processMessage(result.prompt, undefined, true, true);
			}
		},
		[stdout, options],
	);

	return {handleCommandExecution};
}
