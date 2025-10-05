import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, Static, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import ChatInput from '../components/ChatInput.js';
import { type Message } from '../components/MessageList.js';
import PendingMessages from '../components/PendingMessages.js';
import SessionListScreen from '../components/SessionListScreen.js';
import MCPInfoPanel from '../components/MCPInfoPanel.js';
import { createStreamingChatCompletion, type ChatMessage } from '../../api/chat.js';
import { collectAllMCPTools } from '../../utils/mcpToolsManager.js';
import { getOpenAiConfig } from '../../utils/apiConfig.js';
import { sessionManager } from '../../utils/sessionManager.js';
import { useSessionSave } from '../../hooks/useSessionSave.js';
import { parseAndValidateFileReferences, createMessageWithFileInstructions } from '../../utils/fileUtils.js';
// Import commands to register them
import '../../utils/commands/clear.js';
import '../../utils/commands/resume.js';
import '../../utils/commands/mcp.js';

type Props = {};

type MCPInfoScreenProps = {
	onClose: () => void;
	panelKey: number;
};

function MCPInfoScreen({ onClose, panelKey }: MCPInfoScreenProps) {
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	useInput((_, key) => {
		if (key.escape) {
			onClose();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1} borderStyle="double" paddingX={2} paddingY={1} borderColor={'cyan'}>
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❆ </Text>
						MCP Services Overview
					</Text>
					<Text color="gray" dimColor>
						Press ESC to return to the chat
					</Text>
				</Box>
			</Box>
			<MCPInfoPanel key={panelKey} />
		</Box>
	);
}

export default function ChatScreen({ }: Props) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [animationFrame, setAnimationFrame] = useState(0);
	const [abortController, setAbortController] = useState<AbortController | null>(null);
	const [pendingMessages, setPendingMessages] = useState<string[]>([]);
	const [showSessionList, setShowSessionList] = useState(false);
	const [remountKey, setRemountKey] = useState(0);
	const [showMcpInfo, setShowMcpInfo] = useState(false);
	const [mcpPanelKey, setMcpPanelKey] = useState(0);
	const { stdout } = useStdout();
	const workingDirectory = process.cwd();

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

	// ESC key handler to interrupt streaming or close overlays
	useInput((_, key) => {
		if (showMcpInfo) {
			if (key.escape) {
				setShowMcpInfo(false);
			}
			return;
		}

		if (key.escape && isStreaming && abortController) {
			abortController.abort();
			setMessages(prev => {
				const newMessages = [...prev];
				const lastMessage = newMessages[newMessages.length - 1];
				if (lastMessage && lastMessage.streaming) {
					lastMessage.streaming = false;
					lastMessage.discontinued = true;
					lastMessage.renderedLines = undefined;
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
			if (stdout && typeof stdout.write === 'function') {
				stdout.write('\x1B[3J\x1B[2J\x1B[H');
			}
			// Clear current session and start new one
			sessionManager.clearCurrentSession();
			clearSavedMessages();
			setMessages([]);
			setRemountKey(prev => prev + 1); // Force Static to remount
			// Add command execution feedback
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages([commandMessage]);
		} else if (result.success && result.action === 'resume') {
			if (stdout && typeof stdout.write === 'function') {
				stdout.write('\x1B[3J\x1B[2J\x1B[H');
			}
			// Show session list screen
			setShowSessionList(true);
		} else if (result.success && result.action === 'showMcpInfo') {
			setShowMcpInfo(true);
			setMcpPanelKey(prev => prev + 1);
			const commandMessage: Message = {
				role: 'command',
				content: '',
				commandName: commandName
			};
			setMessages(prev => [...prev, commandMessage]);
		}
	};

	const handleSessionSelect = async (sessionId: string) => {
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				if (stdout && typeof stdout.write === 'function') {
					stdout.write('\x1B[3J\x1B[2J\x1B[H');
				}
				// Convert session messages back to UI messages, filtering out system messages
				const uiMessages: Message[] = session.messages
					.filter(msg => msg.role !== 'system')
					.map(msg => ({
						role: msg.role as 'user' | 'assistant',
						content: msg.content,
						streaming: false
					}));
				setMessages(uiMessages);
				setPendingMessages([]);
				setIsStreaming(false);
				setShowSessionList(false);
				setRemountKey(prev => prev + 1);

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

		const assistantMessage: Message = { role: 'assistant', content: '', streaming: true, renderedLines: [] };
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
						lastMessage.renderedLines = undefined;
					}
					return newMessages;
				});
				// Save the final message
				await onStreamingComplete(finalMessage);
			} else {
				// Create message for AI with file read instructions (use already parsed data)
				const messageForAI = createMessageWithFileInstructions(cleanContent, validFiles);

				// Collect all MCP tools
				const mcpTools = await collectAllMCPTools();

				const chatMessages: ChatMessage[] = [
					{ role: 'system', content: 'You are a helpful coding assistant.' },
					...messages.filter(msg => msg.role !== 'command').map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
					{ role: 'user', content: messageForAI }
				];

				let fullResponse = '';
				
				for await (const chunk of createStreamingChatCompletion({
					model,
					messages: chatMessages,
					temperature: 0,
					tools: mcpTools.length > 0 ? mcpTools : undefined
				}, controller.signal)) {
					if (controller.signal.aborted) break;

					if (!chunk) {
						continue;
					}

					fullResponse += chunk;

					setMessages(prev => {
						const newMessages = [...prev];
						const lastMessage = newMessages[newMessages.length - 1];
						if (lastMessage && lastMessage.streaming) {
							lastMessage.content += chunk;
							if (lastMessage.renderedLines) {
								lastMessage.renderedLines.push(chunk);
							} else {
								lastMessage.renderedLines = [chunk];
							}
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
						lastMessage.renderedLines = undefined;
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
					lastMessage.renderedLines = undefined;
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

		const assistantMessage: Message = { role: 'assistant', content: '', streaming: true, renderedLines: [] };
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
						lastMessage.renderedLines = undefined;
					}
					return newMessages;
				});
				await onStreamingComplete(finalMessage);
			} else {
				// Collect all MCP tools
				const mcpTools = await collectAllMCPTools();

				const chatMessages: ChatMessage[] = [
					{ role: 'system', content: 'You are a helpful coding assistant.' },
					...messages.filter(msg => msg.role !== 'command').map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
					{ role: 'user', content: combinedMessage }
				];

				let fullResponse = '';

				for await (const chunk of createStreamingChatCompletion({
					model,
					messages: chatMessages,
					temperature: 0,
					tools: mcpTools.length > 0 ? mcpTools : undefined
				}, controller.signal)) {
					if (controller.signal.aborted) break;

					if (!chunk) {
						continue;
					}

					fullResponse += chunk;

					setMessages(prev => {
						const newMessages = [...prev];
						const lastMessage = newMessages[newMessages.length - 1];
						if (lastMessage && lastMessage.streaming) {
							lastMessage.content += chunk;
							if (lastMessage.renderedLines) {
								lastMessage.renderedLines.push(chunk);
							} else {
								lastMessage.renderedLines = [chunk];
							}
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
						lastMessage.renderedLines = undefined;
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
					lastMessage.renderedLines = undefined;
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


	// If showing session list, only render that - don't render chat at all
	if (showSessionList) {
		return (
			<SessionListScreen
				onBack={handleBackFromSessionList}
				onSelectSession={handleSessionSelect}
			/>
		);
	}

	if (showMcpInfo) {
		return (
			<MCPInfoScreen
				onClose={() => setShowMcpInfo(false)}
				panelKey={mcpPanelKey}
			/>
		);
	}

	return (
		<Box flexDirection="column">
			<Static key={remountKey} items={[
				<Box key="header" marginX={1} borderColor={'cyan'} borderStyle="round" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Text color="white" bold>
							<Text color="cyan">❆ </Text>
							<Gradient name="rainbow">Programming efficiency x10!</Gradient>
							<Text color="white"> ⛇</Text>
						</Text>
						<Text color="gray" dimColor>
							• Ask for code explanations and debugging help
						</Text>
						<Text color="gray" dimColor>
							• Press ESC during response to interrupt
						</Text>
						<Text color="gray" dimColor>
							• Working directory: {workingDirectory}
						</Text>
					</Box>
				</Box>,
				...messages.filter(m => !m.streaming).map((message, index) => (
						<Box key={`msg-${index}`} marginBottom={1} marginX={1} flexDirection="column">
							<Box>
								<Text color={
										message.role === 'user' ? 'green' :
										message.role === 'command' ? 'gray' : 'cyan'
									} bold>
										{message.role === 'user' ? '⛇' : message.role === 'command' ? '⌘' : '❆'}
									</Text>
									<Box marginLeft={1} marginBottom={1} flexDirection="column">
										{message.role === 'command' ? (
											<Text color="gray">
												└─ {message.commandName}
											</Text>
										) : (
											<>
												<Text color={message.role === 'user' ? 'gray' : ''}>
													{message.content}
												</Text>
												{message.files && message.files.length > 0 && (
													<Box marginTop={1} flexDirection="column">
														{message.files.map((file, fileIndex) => (
															<Text key={fileIndex} color="blue">
																└─ Read `{file.path}`{file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}
															</Text>
														))}
													</Box>
												)}
												{message.discontinued && (
													<Text color="red" bold>
														└─ user discontinue
													</Text>
												)}
											</>
										)}
									</Box>
								</Box>
							</Box>
						))
					]}>
						{(item) => item}
					</Static>

					{/* Streaming message - not in Static */}
					{messages.filter(m => m.streaming).map((message, index) => (
						<Box key={`streaming-${index}`} marginBottom={1} marginX={1}>
							<Text color={(['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'][animationFrame] as any)} bold>
								❆
							</Text>
							<Box marginLeft={1} marginBottom={1} flexDirection="column">
								<Text>
									{message.content}
								</Text>
							</Box>
						</Box>
					))}

					<Box marginX={1}>
						<PendingMessages pendingMessages={pendingMessages} />
					</Box>

					<ChatInput
						onSubmit={handleMessageSubmit}
						onCommand={handleCommandExecution}
						placeholder="Ask me anything about coding..."
						disabled={false}
						chatHistory={messages}
						onHistorySelect={handleHistorySelect}
					/>
		</Box>
	);
}
