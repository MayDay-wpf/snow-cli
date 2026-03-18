import {useRef, useEffect} from 'react';
import type {UseChatLogicProps, Message} from './types.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {handleConversationWithTools} from '../useConversation.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
} from '../../../utils/core/fileUtils.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../../utils/core/autoCompress.js';
import {
	getOpenAiConfig,
	DEFAULT_AUTO_COMPRESS_THRESHOLD,
} from '../../../utils/config/apiConfig.js';
import {runningSubAgentTracker} from '../../../utils/execution/runningSubAgentTracker.js';

/**
 * Parse "# SubAgentTarget:instanceId:agentName" markers from a message.
 * These are injected by the running-agents picker via TextBuffer placeholders.
 * Returns the target sub-agent info and the clean message (markers stripped).
 */
function parseSubAgentTargets(message: string): {
	targets: Array<{instanceId: string; agentName: string}>;
	cleanMessage: string;
} {
	const targets: Array<{instanceId: string; agentName: string}> = [];
	const lines = message.split('\n');
	const cleanLines: string[] = [];

	for (const line of lines) {
		if (line.startsWith('# SubAgentTarget:')) {
			const rest = line.slice('# SubAgentTarget:'.length);
			const colonIdx = rest.indexOf(':');
			if (colonIdx !== -1) {
				const instanceId = rest.slice(0, colonIdx);
				const agentName = rest.slice(colonIdx + 1);
				targets.push({instanceId, agentName});
			}
		} else {
			cleanLines.push(line);
		}
	}

	const cleanMessage = cleanLines.join('\n').trim();
	return {targets, cleanMessage};
}

export function useMessageProcessing(props: UseChatLogicProps) {
	const {
		messages,
		setMessages,
		setPendingMessages,
		streamingState,
		vscodeState,
		snapshotState,
		bashMode,
		yoloMode,
		planMode,
		vulnerabilityHuntingMode,
		toolSearchDisabled,
		saveMessage,
		clearSavedMessages,
		setRemountKey,
		requestToolConfirmation,
		requestUserQuestion,
		isToolAutoApproved,
		addMultipleToAlwaysApproved,
		setRestoreInputContent,
		setIsCompressing,
		setCompressionError,
		currentContextPercentageRef,
		userInterruptedRef,
		pendingMessagesRef,
		setBashSensitiveCommand,
	} = props;

	const processMessageRef =
		useRef<
			(
				message: string,
				images?: Array<{data: string; mimeType: string}>,
				useBasicModel?: boolean,
				hideUserMessage?: boolean,
			) => Promise<void>
		>();

	const yoloModeRef = useRef(yoloMode);

	useEffect(() => {
		yoloModeRef.current = yoloMode;
	}, [yoloMode]);

	const processMessage = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => {
		const autoCompressConfig = getOpenAiConfig();
		if (
			autoCompressConfig.enableAutoCompress !== false &&
			shouldAutoCompress(
				currentContextPercentageRef.current,
				autoCompressConfig.autoCompressThreshold ??
					DEFAULT_AUTO_COMPRESS_THRESHOLD,
			)
		) {
			setIsCompressing(true);
			streamingState.setIsAutoCompressing(true);
			setCompressionError(null);

			try {
				const compressingMessage: Message = {
					role: 'assistant',
					content: '✵ Auto-compressing context due to token limit...',
					streaming: false,
				};
				setMessages(prev => [...prev, compressingMessage]);

				const session = sessionManager.getCurrentSession();
				const compressionResult = await performAutoCompression(session?.id);

				if (compressionResult) {
					clearSavedMessages();
					setMessages(compressionResult.uiMessages);
					setRemountKey(prev => prev + 1);
					streamingState.setContextUsage(compressionResult.usage);
					snapshotState.setSnapshotFileCount(new Map());
				} else {
					setMessages(prev => prev.filter(m => m !== compressingMessage));
				}
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				setCompressionError(errorMsg);

				const errorMessage: Message = {
					role: 'assistant',
					content: `**Auto-compression Failed**\n\n${errorMsg}`,
					streaming: false,
				};
				setMessages(prev => [...prev, errorMessage]);
				setIsCompressing(false);
				streamingState.setIsAutoCompressing(false);
				return;
			} finally {
				setIsCompressing(false);
				streamingState.setIsAutoCompressing(false);
			}
		}

		streamingState.setRetryStatus(null);

		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			message,
		);

		const imageFiles = validFiles.filter(
			f => f.isImage && f.imageData && f.mimeType,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);

		const imageContents = [
			...(images || []).map(img => ({
				type: 'image' as const,
				data: img.data,
				mimeType: img.mimeType,
			})),
			...imageFiles.map(f => ({
				type: 'image' as const,
				data: f.imageData!,
				mimeType: f.mimeType!,
			})),
		];

		if (!hideUserMessage) {
			const userMessage: Message = {
				role: 'user',
				content: cleanContent,
				files: validFiles.length > 0 ? validFiles : undefined,
				images: imageContents.length > 0 ? imageContents : undefined,
			};
			setMessages(prev => [...prev, userMessage]);
		}
		streamingState.setIsStreaming(true);

		const controller = new AbortController();
		streamingState.setAbortController(controller);

		let originalMessage = message;
		let optimizedMessage = message;
		let optimizedCleanContent = cleanContent;

		try {
			const messageForAI = createMessageWithFileInstructions(
				optimizedCleanContent,
				regularFiles,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			const saveMessageWithOriginal = async (msg: any) => {
				if (msg.role === 'user' && optimizedMessage !== originalMessage) {
					await saveMessage({
						...msg,
						originalContent: originalMessage,
						editorContext: messageForAI.editorContext,
					});
				} else {
					await saveMessage({
						...msg,
						editorContext:
							msg.role === 'user' ? messageForAI.editorContext : undefined,
					});
				}
			};

			try {
				await handleConversationWithTools({
					userContent: messageForAI.content,
					editorContext: messageForAI.editorContext,
					imageContents,
					controller,
					messages,
					saveMessage: saveMessageWithOriginal,
					setMessages,
					setStreamTokenCount: streamingState.setStreamTokenCount,
					requestToolConfirmation,
					requestUserQuestion,
					isToolAutoApproved,
					addMultipleToAlwaysApproved,
					yoloModeRef,
					planMode,
					vulnerabilityHuntingMode,
					toolSearchDisabled,
					setContextUsage: streamingState.setContextUsage,
					useBasicModel,
					getPendingMessages: () => pendingMessagesRef.current,
					clearPendingMessages: () => setPendingMessages([]),
					setIsStreaming: streamingState.setIsStreaming,
					setIsReasoning: streamingState.setIsReasoning,
					setRetryStatus: streamingState.setRetryStatus,
					clearSavedMessages,
					setRemountKey,
					setSnapshotFileCount: snapshotState.setSnapshotFileCount,
					getCurrentContextPercentage: () =>
						currentContextPercentageRef.current,
					setCurrentModel: streamingState.setCurrentModel,
					onCompressionStatus: props.onCompressionStatus,
					setIsAutoCompressing: streamingState.setIsAutoCompressing,
				});
			} finally {
				// On-demand backup system - snapshot management is automatic
			}
		} catch (error) {
			if (!controller.signal.aborted && !userInterruptedRef.current) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
					messageStatus: 'error',
				};
				setMessages(prev => [...prev, finalMessage]);
			}
		} finally {
			if (userInterruptedRef.current) {
				const session = sessionManager.getCurrentSession();
				if (session && session.messages.length > 0) {
					(async () => {
						try {
							const messages = session.messages;
							let truncateIndex = messages.length;

							for (let i = messages.length - 1; i >= 0; i--) {
								const msg = messages[i];
								if (!msg) continue;

								if (
									msg.role === 'assistant' &&
									msg.tool_calls &&
									msg.tool_calls.length > 0
								) {
									const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
									for (let j = i + 1; j < messages.length; j++) {
										const followMsg = messages[j];
										if (
											followMsg &&
											followMsg.role === 'tool' &&
											followMsg.tool_call_id
										) {
											toolCallIds.delete(followMsg.tool_call_id);
										}
									}
									if (toolCallIds.size > 0) {
										let hasLaterAssistantWithTools = false;
										for (let k = i + 1; k < messages.length; k++) {
											const laterMsg = messages[k];
											if (
												laterMsg?.role === 'assistant' &&
												laterMsg?.tool_calls &&
												laterMsg.tool_calls.length > 0
											) {
												hasLaterAssistantWithTools = true;
												break;
											}
										}

										if (!hasLaterAssistantWithTools) {
											truncateIndex = i;
											break;
										}
									}
								}

								if (msg.role === 'assistant' && !msg.tool_calls) {
									break;
								}
							}

							if (truncateIndex < messages.length) {
								await sessionManager.truncateMessages(truncateIndex);
								clearSavedMessages();
							}
						} catch (error) {
							console.error(
								'Failed to clean up incomplete conversation:',
								error,
							);
						}
					})();
				}

				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						streaming: false,
						discontinued: true,
					},
				]);

				userInterruptedRef.current = false;

				streamingState.setIsStopping(false);
			}

			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	};

	processMessageRef.current = processMessage;

	const handleMessageSubmit = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => {
		const {targets: subAgentTargets, cleanMessage: messageWithoutTargets} =
			parseSubAgentTargets(message);

		if (subAgentTargets.length > 0 && messageWithoutTargets) {
			const injectedTargets: Array<{
				agentName: string;
				promptSnippet: string;
			}> = [];

			for (const target of subAgentTargets) {
				const success = runningSubAgentTracker.enqueueMessage(
					target.instanceId,
					messageWithoutTargets,
				);
				if (success) {
					const runningAgents = runningSubAgentTracker.getRunningAgents();
					const agentInfo = runningAgents.find(
						a => a.instanceId === target.instanceId,
					);
					const rawPrompt = agentInfo?.prompt || '';
					const snippet = rawPrompt
						.replace(/[\r\n]+/g, ' ')
						.replace(/\s+/g, ' ')
						.trim();
					const maxLen = 30;
					const promptSnippet =
						snippet.length > maxLen ? snippet.slice(0, maxLen) + '…' : snippet;
					injectedTargets.push({
						agentName: target.agentName,
						promptSnippet,
					});
				}
			}

			if (injectedTargets.length > 0) {
				setMessages(prev => [
					...prev,
					{
						role: 'user',
						content: messageWithoutTargets,
						subAgentDirected: {
							targets: injectedTargets,
						},
					},
				]);
				return;
			}

			message = messageWithoutTargets;
		} else if (subAgentTargets.length > 0) {
			message = messageWithoutTargets;
		}

		if (streamingState.streamStatus !== 'idle') {
			setPendingMessages(prev => [...prev, {text: message, images}]);
			return;
		}

		try {
			const {unifiedHooksExecutor} = await import(
				'../../../utils/execution/unifiedHooksExecutor.js'
			);
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onUserMessage',
				{
					message,
					imageCount: images?.length || 0,
					source: 'normal',
				},
			);
			const {handleHookResult} = await import(
				'../../../utils/execution/hookResultHandler.js'
			);
			const handlerResult = handleHookResult(hookResult, message);

			if (!handlerResult.shouldContinue && handlerResult.errorDetails) {
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						timestamp: new Date(),
						hookError: handlerResult.errorDetails,
					},
				]);
				return;
			}

			message = handlerResult.modifiedMessage!;
		} catch (error) {
			console.error('Failed to execute onUserMessage hook:', error);
		}

		// 先检查纯 Bash 模式（双感叹号）
		try {
			const pureBashResult = await bashMode.processPureBashMessage(
				message,
				async (command: string) => {
					return new Promise<boolean>(resolve => {
						setBashSensitiveCommand({command, resolve});
					});
				},
			);

			if (pureBashResult.hasCommands) {
				if (pureBashResult.hasRejectedCommands) {
					setRestoreInputContent({
						text: message,
						images: images?.map(img => ({type: 'image' as const, ...img})),
					});
					return;
				}

				const formatted = pureBashResult.results
					.map(
						(r: {
							stdout: string;
							stderr: string;
							command: string;
							exitCode: number | null;
						}) => {
							const stdout = (r.stdout || '').trim();
							const stderr = (r.stderr || '').trim();
							const combined = [stdout, stderr].filter(Boolean).join('\n');
							const output = combined.length > 0 ? combined : '(no output)';
							const exitInfo =
								r.exitCode === null || r.exitCode === undefined
									? 'exit: (unknown)'
									: `exit: ${r.exitCode}`;
							return [
								'```text',
								`$ ${r.command}`,
								output,
								`(${exitInfo})`,
								'```',
							].join('\n');
						},
					)
					.join('\n\n');

				const bashOutputMessage: Message = {
					role: 'assistant',
					content: formatted || '```text\n(no output)\n```',
				};

				setMessages(prev => [...prev, bashOutputMessage]);
				try {
					await saveMessage(bashOutputMessage);
				} catch (error) {
					console.error('Failed to save pure bash output message:', error);
				}
				return;
			}
		} catch (error) {
			console.error('Failed to process pure bash commands:', error);
		}

		// 再检查命令注入模式（单感叹号）
		try {
			const result = await bashMode.processBashMessage(
				message,
				async (command: string) => {
					return new Promise<boolean>(resolve => {
						setBashSensitiveCommand({command, resolve});
					});
				},
			);

			if (result.hasRejectedCommands) {
				setRestoreInputContent({
					text: message,
					images: images?.map(img => ({type: 'image' as const, ...img})),
				});
				return;
			}

			message = result.processedMessage;
		} catch (error) {
			console.error('Failed to process bash commands:', error);
		}

		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) {
			await sessionManager.createNewSession();
		}

		await processMessage(message, images);
	};

	const processPendingMessages = async () => {
		const pendingMessages = pendingMessagesRef.current;
		if (pendingMessages.length === 0) return;

		streamingState.setRetryStatus(null);

		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		const combinedMessage = messagesToProcess.map(m => m.text).join('\n\n');

		let messageToSend = combinedMessage;
		try {
			const {unifiedHooksExecutor} = await import(
				'../../../utils/execution/unifiedHooksExecutor.js'
			);
			const allImages = messagesToProcess.flatMap(m => m.images || []);
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'onUserMessage',
				{
					message: combinedMessage,
					imageCount: allImages.length,
					source: 'pending',
				},
			);
			const {handleHookResult} = await import(
				'../../../utils/execution/hookResultHandler.js'
			);
			const handlerResult = handleHookResult(hookResult, combinedMessage);

			if (!handlerResult.shouldContinue && handlerResult.errorDetails) {
				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						timestamp: new Date(),
						hookError: handlerResult.errorDetails,
					},
				]);
				return;
			}

			messageToSend = handlerResult.modifiedMessage!;
		} catch (error) {
			console.error('Failed to execute onUserMessage hook:', error);
		}

		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			messageToSend,
		);

		const imageFiles = validFiles.filter(
			f => f.isImage && f.imageData && f.mimeType,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);

		const allImages = messagesToProcess
			.flatMap(m => m.images || [])
			.concat(
				imageFiles.map(f => ({
					data: f.imageData!,
					mimeType: f.mimeType!,
				})),
			);

		const imageContents =
			allImages.length > 0
				? allImages.map(img => ({
						type: 'image' as const,
						data: img.data,
						mimeType: img.mimeType,
				  }))
				: undefined;

		const userMessage: Message = {
			role: 'user',
			content: cleanContent,
			files: validFiles.length > 0 ? validFiles : undefined,
			images: imageContents,
		};
		setMessages(prev => [...prev, userMessage]);

		streamingState.setIsStreaming(true);

		const controller = new AbortController();
		streamingState.setAbortController(controller);

		try {
			const messageForAI = createMessageWithFileInstructions(
				cleanContent,
				regularFiles,
				vscodeState.vscodeConnected ? vscodeState.editorContext : undefined,
			);

			try {
				await handleConversationWithTools({
					userContent: messageForAI.content,
					editorContext: messageForAI.editorContext,
					imageContents,
					controller,
					messages,
					saveMessage,
					setMessages,
					setStreamTokenCount: streamingState.setStreamTokenCount,
					requestToolConfirmation,
					requestUserQuestion,
					isToolAutoApproved,
					addMultipleToAlwaysApproved,
					yoloModeRef,
					planMode,
					vulnerabilityHuntingMode,
					toolSearchDisabled,
					setContextUsage: streamingState.setContextUsage,
					getPendingMessages: () => pendingMessagesRef.current,
					clearPendingMessages: () => setPendingMessages([]),
					setIsStreaming: streamingState.setIsStreaming,
					setIsReasoning: streamingState.setIsReasoning,
					setRetryStatus: streamingState.setRetryStatus,
					clearSavedMessages,
					setRemountKey,
					setSnapshotFileCount: snapshotState.setSnapshotFileCount,
					getCurrentContextPercentage: () =>
						currentContextPercentageRef.current,
					setCurrentModel: streamingState.setCurrentModel,
					onCompressionStatus: props.onCompressionStatus,
					setIsAutoCompressing: streamingState.setIsAutoCompressing,
				});
			} finally {
				// Snapshots are now created on-demand during file operations
			}
		} catch (error) {
			if (!controller.signal.aborted && !userInterruptedRef.current) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
					messageStatus: 'error',
				};
				setMessages(prev => [...prev, finalMessage]);
			}
		} finally {
			if (userInterruptedRef.current) {
				const session = sessionManager.getCurrentSession();
				if (session && session.messages.length > 0) {
					(async () => {
						try {
							const messages = session.messages;
							let truncateIndex = messages.length;

							for (let i = messages.length - 1; i >= 0; i--) {
								const msg = messages[i];
								if (!msg) continue;

								if (
									msg.role === 'assistant' &&
									msg.tool_calls &&
									msg.tool_calls.length > 0
								) {
									const toolCallIds = new Set(msg.tool_calls.map(tc => tc.id));
									for (let j = i + 1; j < messages.length; j++) {
										const followMsg = messages[j];
										if (
											followMsg &&
											followMsg.role === 'tool' &&
											followMsg.tool_call_id
										) {
											toolCallIds.delete(followMsg.tool_call_id);
										}
									}
									if (toolCallIds.size > 0) {
										truncateIndex = i;
										break;
									}
								}

								if (msg.role === 'assistant' && !msg.tool_calls) {
									break;
								}
							}

							if (truncateIndex < messages.length) {
								await sessionManager.truncateMessages(truncateIndex);
								clearSavedMessages();
							}
						} catch (error) {
							console.error(
								'Failed to clean up incomplete conversation:',
								error,
							);
						}
					})();
				}

				setMessages(prev => [
					...prev,
					{
						role: 'assistant',
						content: '',
						streaming: false,
						discontinued: true,
					},
				]);

				userInterruptedRef.current = false;

				streamingState.setIsStopping(false);
			}

			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	};

	return {
		handleMessageSubmit,
		processMessage,
		processMessageRef,
		processPendingMessages,
	};
}
