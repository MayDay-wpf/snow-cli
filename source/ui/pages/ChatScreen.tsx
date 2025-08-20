import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Gradient from 'ink-gradient';
import ChatInput from '../components/ChatInput.js';
import MessageList, { type Message } from '../components/MessageList.js';
import PendingMessages from '../components/PendingMessages.js';
import SessionListScreen from '../components/SessionListScreen.js';
import { createStreamingChatCompletion, type ChatMessage } from '../../api/chat.js';
import { getOpenAiConfig } from '../../utils/apiConfig.js';
import { sessionManager } from '../../utils/sessionManager.js';
import { useSessionSave } from '../../hooks/useSessionSave.js';
import { parseAndValidateFileReferences, createMessageWithFileInstructions } from '../../utils/fileUtils.js';
// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';

type Props = {};

export default function ChatScreen({ }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [abortController, setAbortController] = useState<AbortController | null>(null);
	const [pendingMessages, setPendingMessages] = useState<string[]>([]);
	const [showSessionList, setShowSessionList] = useState(false);

	// Use session save hook
	const { onStreamingComplete, onUserMessage, clearSavedMessages, initializeFromSession } = useSessionSave();

	// Animation for streaming indicator
	useEffect(() => {
		if (!isStreaming) return;

		const interval = setInterval(() => {
			setAnimationFrame(prev => (prev + 1) % 5);
		}, 300);

		return () => clearInterval(interval);
	}, [isStreaming]);

	// Auto-send pending messages when streaming stops
	useEffect(() => {
		if (!isStreaming && pendingMessages.length > 0) {
			// Use setTimeout to ensure state updates are complete
			const timer = setTimeout(() => {
				processPendingMessages();
			}, 100);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [isStreaming, pendingMessages.length]);

	// ESC key handler to interrupt streaming
	useInput((_, key) => {
		if (key.escape && isStreaming && abortController) {
			abortController.abort();
			setMessages(prev => {
				const newMessages = [...prev];
				const lastMessage = newMessages[newMessages.length - 1];
				if (lastMessage && lastMessage.streaming) {
					lastMessage.streaming = false;
					lastMessage.discontinued = true;
				}
				return newMessages;
			});
			// Reset streaming state, useEffect will handle pending messages
			setIsStreaming(false);
			setAbortController(null);
		}
	});

	const handleCommandExecution = (commandName: string, result: any) => {
		if (result.success && result.action === 'clear') {
			// Clear current session and start new one
			sessionManager.clearCurrentSession();
			clearSavedMessages();
			setMessages([]);
			// Add command execution feedback
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages([commandMessage]);
		} else if (result.success && result.action === 'resume') {
			// Show session list screen
			setShowSessionList(true);
		}
	};

	const handleSessionSelect = async (sessionId: string) => {
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				// Convert session messages back to UI messages, filtering out system messages
				const uiMessages: Message[] = session.messages
					.filter(msg => msg.role !== 'system')
					.map(msg => ({
						role: msg.role as 'user' | 'assistant',
						content: msg.content,
						streaming: false
					}));
				setMessages(uiMessages);
				setShowSessionList(false);

				// Initialize session save hook with loaded messages
				initializeFromSession(uiMessages);
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	const handleBackFromSessionList = () => {
		setShowSessionList(false);
	};

	const handleHistorySelect = (selectedIndex: number, _message: string) => {
		// Truncate messages array to remove the selected user message and everything after it
		// Keep everything before the selected message (exclude the selected message itself)
		setMessages(prev => prev.slice(0, selectedIndex));
	};

	const handleMessageSubmit = async (message: string) => {
		// If streaming, add to pending messages instead of sending immediately
		if (isStreaming) {
			setPendingMessages(prev => [...prev, message]);
			return;
		}

		// Process the message normally
		await processMessage(message);
	};

	const processMessage = async (message: string) => {
		// Parse and validate file references
		const { cleanContent, validFiles } = await parseAndValidateFileReferences(message);

		const userMessage: Message = {
			role: 'user',
			content: cleanContent,
			files: validFiles.length > 0 ? validFiles : undefined
		};
		setMessages(prev => [...prev, userMessage]);
		setIsStreaming(true);

		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		const assistantMessage: Message = { role: 'assistant', content: '', streaming: true };
		setMessages(prev => [...prev, assistantMessage]);

		// Save user message in background (non-blocking)
		onUserMessage(userMessage).catch(error => {
			console.error('Failed to save user message:', error);
		});

		try {
			const config = getOpenAiConfig();
			const model = config.advancedModel || 'gpt-4.1';

			// Check if request method is responses (not yet implemented)
			if (config.requestMethod === 'responses') {
				const finalMessage: Message = {
					role: 'assistant',
					content: 'Responses API is not yet implemented. Please use "Chat Completions" method in API settings.',
					streaming: false
				};
				setMessages(prev => {
					const newMessages = [...prev];
					const lastMessage = newMessages[newMessages.length - 1];
					if (lastMessage) {
						lastMessage.content = finalMessage.content;
						lastMessage.streaming = false;
					}
					return newMessages;
				});
				// Save the final message
				await onStreamingComplete(finalMessage);
			} else {
				// Create message for AI with file read instructions (use already parsed data)
				const messageForAI = createMessageWithFileInstructions(cleanContent, validFiles);

				const chatMessages: ChatMessage[] = [
					{ role: 'system', content: 'You are a helpful coding assistant.' },
					...messages.filter(msg => msg.role !== 'command').map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
					{ role: 'user', content: messageForAI }
				];

				let fullResponse = '';
				let currentLine = '';

				for await (const chunk of createStreamingChatCompletion({
					model,
					messages: chatMessages,
					temperature: 0
				}, controller.signal)) {
					if (controller.signal.aborted) break;

					currentLine += chunk;

					// Check if we have a complete line (contains newline or certain punctuation)
					if (chunk.includes('\n') || chunk.includes('.') || chunk.includes('!') || chunk.includes('?') || chunk.includes(';')) {
						fullResponse += currentLine;
						currentLine = '';

						setMessages(prev => {
							const newMessages = [...prev];
							const lastMessage = newMessages[newMessages.length - 1];
							if (lastMessage && lastMessage.streaming) {
								lastMessage.content = fullResponse;
							}
							return newMessages;
						});
					}
				}

				// Add any remaining content
				if (currentLine && !controller.signal.aborted) {
					fullResponse += currentLine;
					setMessages(prev => {
						const newMessages = [...prev];
						const lastMessage = newMessages[newMessages.length - 1];
						if (lastMessage && lastMessage.streaming) {
							lastMessage.content = fullResponse;
						}
						return newMessages;
					});
				}

				const finalMessage: Message = {
					role: 'assistant',
					content: fullResponse,
					streaming: false,
					discontinued: controller.signal.aborted
				};

				setMessages(prev => {
					const newMessages = [...prev];
					const lastMessage = newMessages[newMessages.length - 1];
					if (lastMessage && !lastMessage.discontinued) {
						lastMessage.streaming = false;
					}
					return newMessages;
				});

				// Save the final assistant message
				if (!controller.signal.aborted) {
					await onStreamingComplete(finalMessage);
				}
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false
			};
			setMessages(prev => {
				const newMessages = [...prev];
				const lastMessage = newMessages[newMessages.length - 1];
				if (lastMessage) {
					lastMessage.content = finalMessage.content;
					lastMessage.streaming = false;
				}
				return newMessages;
			});
			// Save error message
			await onStreamingComplete(finalMessage);
		} finally {
			setIsStreaming(false);
			setAbortController(null);
		}
	};

	const processPendingMessages = async () => {
		if (pendingMessages.length === 0) return;

		// Get current pending messages and clear them immediately to prevent infinite loop
		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		// Combine multiple pending messages into one
		const combinedMessage = messagesToProcess.join('\n\n');

		// Add user message to chat
		const userMessage: Message = { role: 'user', content: combinedMessage };
		setMessages(prev => [...prev, userMessage]);

		// Start streaming response (without calling processMessage to avoid recursion)
		setIsStreaming(true);

		const assistantMessage: Message = { role: 'assistant', content: '', streaming: true };
		setMessages(prev => [...prev, assistantMessage]);
		
		// Create new abort controller for this request
		const controller = new AbortController();
		setAbortController(controller);

		// Save user message in background (non-blocking)
		onUserMessage(userMessage).catch(error => {
			console.error('Failed to save user message:', error);
		});

		try {
			const config = getOpenAiConfig();
			const model = config.advancedModel || 'gpt-4.1';

			// Check if request method is responses (not yet implemented)
			if (config.requestMethod === 'responses') {
				const finalMessage: Message = {
					role: 'assistant',
					content: 'Responses API is not yet implemented. Please use "Chat Completions" method in API settings.',
					streaming: false
				};
				setMessages(prev => {
					const newMessages = [...prev];
					const lastMessage = newMessages[newMessages.length - 1];
					if (lastMessage) {
						lastMessage.content = finalMessage.content;
						lastMessage.streaming = false;
					}
					return newMessages;
				});
				await onStreamingComplete(finalMessage);
			} else {
				const chatMessages: ChatMessage[] = [
					{ role: 'system', content: 'You are a helpful coding assistant.' },
					...messages.filter(msg => msg.role !== 'command').map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
					{ role: 'user', content: combinedMessage }
				];

				let fullResponse = '';
				let currentLine = '';

				for await (const chunk of createStreamingChatCompletion({
					model,
					messages: chatMessages,
					temperature: 0
				}, controller.signal)) {
					if (controller.signal.aborted) break;

					currentLine += chunk;

					// Check if we have a complete line (contains newline or certain punctuation)
					if (chunk.includes('\n') || chunk.includes('.') || chunk.includes('!') || chunk.includes('?') || chunk.includes(';')) {
						fullResponse += currentLine;
						currentLine = '';

						setMessages(prev => {
							const newMessages = [...prev];
							const lastMessage = newMessages[newMessages.length - 1];
							if (lastMessage && lastMessage.streaming) {
								lastMessage.content = fullResponse;
							}
							return newMessages;
						});
					}
				}

				// Add any remaining content
				if (currentLine && !controller.signal.aborted) {
					fullResponse += currentLine;
					setMessages(prev => {
						const newMessages = [...prev];
						const lastMessage = newMessages[newMessages.length - 1];
						if (lastMessage && lastMessage.streaming) {
							lastMessage.content = fullResponse;
						}
						return newMessages;
					});
				}

				const finalMessage: Message = {
					role: 'assistant',
					content: fullResponse,
					streaming: false,
					discontinued: controller.signal.aborted
				};

				setMessages(prev => {
					const newMessages = [...prev];
					const lastMessage = newMessages[newMessages.length - 1];
					if (lastMessage && !lastMessage.discontinued) {
						lastMessage.streaming = false;
					}
					return newMessages;
				});

				// Save the final assistant message
				if (!controller.signal.aborted) {
					await onStreamingComplete(finalMessage);
				}
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
			const finalMessage: Message = {
				role: 'assistant',
				content: `Error: ${errorMessage}`,
				streaming: false
			};
			setMessages(prev => {
				const newMessages = [...prev];
				const lastMessage = newMessages[newMessages.length - 1];
				if (lastMessage) {
					lastMessage.content = finalMessage.content;
					lastMessage.streaming = false;
				}
				return newMessages;
			});
			await onStreamingComplete(finalMessage);
		} finally {
			setIsStreaming(false);
			setAbortController(null);
			// Note: No recursive call here, useEffect will handle next batch
		}
	};


	return (
		<Box flexDirection="column" padding={1}>
			{showSessionList ? (
				<SessionListScreen
					onBack={handleBackFromSessionList}
					onSelectSession={handleSessionSelect}
				/>
			) : (
				<>
					<Box marginBottom={1} borderColor={'cyan'} borderStyle="round" paddingX={2} paddingY={1}>
						<Box flexDirection="column">
							<Text color="white" bold>
								<Text color="cyan">❆ </Text>
								<Gradient name="rainbow">Programming efficiency x10!</Gradient>
							</Text>
							<Text color="gray" dimColor>
								• Ask for code explanations and debugging help
							</Text>
							<Text color="gray" dimColor>
								• Press ESC during response to interrupt
							</Text>
							<Text color="gray" dimColor>
								• Double ESC for history • /resume to restore session
							</Text>
						</Box>
					</Box>

					<MessageList
						messages={messages}
						animationFrame={animationFrame}
						maxMessages={6}
					/>

					<PendingMessages pendingMessages={pendingMessages} />

					<Box marginBottom={0} minHeight={15}>
						<ChatInput
							onSubmit={handleMessageSubmit}
							onCommand={handleCommandExecution}
							placeholder="Ask me anything about coding..."
							disabled={false}
							chatHistory={messages}
							onHistorySelect={handleHistorySelect}
						/>
					</Box>
				</>
			)}
		</Box>
	);
}