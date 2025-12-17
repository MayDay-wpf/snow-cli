import {useRef} from 'react';
import {type Message} from '../../ui/components/chat/MessageList.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {handleConversationWithTools} from './useConversation.js';
import {promptOptimizeAgent} from '../../agents/promptOptimizeAgent.js';
import {
	parseAndValidateFileReferences,
	createMessageWithFileInstructions,
	cleanIDEContext,
} from '../../utils/core/fileUtils.js';
import {
	shouldAutoCompress,
	performAutoCompression,
} from '../../utils/core/autoCompress.js';
import {getOpenAiConfig} from '../../utils/config/apiConfig.js';
import {incrementalSnapshotManager} from '../../utils/codebase/incrementalSnapshot.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';
import {logger} from '../../utils/core/logger.js';

interface UseChatLogicProps {
	messages: Message[];
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	pendingMessages: Array<{
		text: string;
		images?: Array<{data: string; mimeType: string}>;
	}>;
	setPendingMessages: React.Dispatch<
		React.SetStateAction<
			Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
		>
	>;
	streamingState: any;
	vscodeState: any;
	snapshotState: any;
	bashMode: any;
	yoloMode: boolean;
	planMode: boolean;
	vulnerabilityHuntingMode: boolean;
	saveMessage: (msg: any) => Promise<void>;
	clearSavedMessages: () => void;
	setRemountKey: React.Dispatch<React.SetStateAction<number>>;
	requestToolConfirmation: any;
	requestUserQuestion: any;
	isToolAutoApproved: any;
	addMultipleToAlwaysApproved: any;
	setRestoreInputContent: React.Dispatch<
		React.SetStateAction<{
			text: string;
			images?: Array<{type: 'image'; data: string; mimeType: string}>;
		} | null>
	>;
	setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
	setCompressionError: React.Dispatch<React.SetStateAction<string | null>>;
	currentContextPercentageRef: React.MutableRefObject<number>;
	userInterruptedRef: React.MutableRefObject<boolean>;
	pendingMessagesRef: React.MutableRefObject<
		Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
	>;
	setBashSensitiveCommand: React.Dispatch<
		React.SetStateAction<{
			command: string;
			resolve: (proceed: boolean) => void;
		} | null>
	>;
}

export function useChatLogic(props: UseChatLogicProps) {
	const {
		messages,
		setMessages,
		pendingMessages,
		setPendingMessages,
		streamingState,
		vscodeState,
		snapshotState,
		bashMode,
		yoloMode,
		planMode,
		vulnerabilityHuntingMode,
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

	const handleMessageSubmit = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => {
		if (streamingState.isStreaming) {
			setPendingMessages(prev => [...prev, {text: message, images}]);
			return;
		}

		try {
			const {unifiedHooksExecutor} = await import(
				'../../utils/execution/unifiedHooksExecutor.js'
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
				'../../utils/execution/hookResultHandler.js'
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
		const session = sessionManager.getCurrentSession();
		if (session) {
			await incrementalSnapshotManager.createSnapshot(
				session.id,
				messages.length,
			);
		}

		await processMessage(message, images);
	};

	const processMessage = async (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => {
		const autoCompressConfig = getOpenAiConfig();
		if (
			autoCompressConfig.enableAutoCompress !== false &&
			shouldAutoCompress(currentContextPercentageRef.current)
		) {
			setIsCompressing(true);
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
				return;
			} finally {
				setIsCompressing(false);
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
			...imageFiles.map(f => {
				let base64Data = f.imageData!;
				const base64Match = base64Data.match(/^data:[^;]+;base64,(.+)$/);
				if (base64Match && base64Match[1]) {
					base64Data = base64Match[1];
				}
				return {
					type: 'image' as const,
					data: base64Data,
					mimeType: f.mimeType!,
				};
			}),
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

		const config = getOpenAiConfig();
		const isOptimizationEnabled = config.enablePromptOptimization !== false;

		if (isOptimizationEnabled) {
			try {
				const conversationHistory = messages
					.filter(m => m.role === 'user' || m.role === 'assistant')
					.map(m => ({
						role: m.role as 'user' | 'assistant',
						content: typeof m.content === 'string' ? m.content : '',
					}));

				optimizedMessage = await promptOptimizeAgent.optimizePrompt(
					message,
					conversationHistory,
					controller.signal,
				);

				if (optimizedMessage !== originalMessage) {
					const optimizedParsed = await parseAndValidateFileReferences(
						optimizedMessage,
					);
					optimizedCleanContent = optimizedParsed.cleanContent;
				}
			} catch (error) {
				logger.warn('Prompt optimization failed, using original:', error);
			}
		}

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
					});
				} else {
					await saveMessage(msg);
				}
			};

			await handleConversationWithTools({
				userContent: messageForAI,
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
				yoloMode,
				planMode,
				vulnerabilityHuntingMode,
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
				getCurrentContextPercentage: () => currentContextPercentageRef.current,
				setCurrentModel: streamingState.setCurrentModel,
			});
		} catch (error) {
			if (!controller.signal.aborted) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
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

								if (msg.role === 'user' && i === messages.length - 1) {
									truncateIndex = i;
									break;
								}

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
			}

			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	};

	processMessageRef.current = processMessage;

	const processPendingMessages = async () => {
		if (pendingMessages.length === 0) return;

		streamingState.setRetryStatus(null);

		const messagesToProcess = [...pendingMessages];
		setPendingMessages([]);

		const combinedMessage = messagesToProcess.map(m => m.text).join('\n\n');

		let messageToSend = combinedMessage;
		try {
			const {unifiedHooksExecutor} = await import(
				'../../utils/execution/unifiedHooksExecutor.js'
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
				'../../utils/execution/hookResultHandler.js'
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
				imageFiles.map(f => {
					let base64Data = f.imageData!;
					const base64Match = base64Data.match(/^data:[^;]+;base64,(.+)$/);
					if (base64Match && base64Match[1]) {
						base64Data = base64Match[1];
					}
					return {
						data: base64Data,
						mimeType: f.mimeType!,
					};
				}),
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

			await handleConversationWithTools({
				userContent: messageForAI,
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
				yoloMode,
				planMode,
				vulnerabilityHuntingMode,
				setContextUsage: streamingState.setContextUsage,
				getPendingMessages: () => pendingMessagesRef.current,
				clearPendingMessages: () => setPendingMessages([]),
				setIsStreaming: streamingState.setIsStreaming,
				setIsReasoning: streamingState.setIsReasoning,
				setRetryStatus: streamingState.setRetryStatus,
				clearSavedMessages,
				setRemountKey,
				setSnapshotFileCount: snapshotState.setSnapshotFileCount,
				getCurrentContextPercentage: () => currentContextPercentageRef.current,
				setCurrentModel: streamingState.setCurrentModel,
			});
		} catch (error) {
			if (!controller.signal.aborted) {
				const errorMessage =
					error instanceof Error ? error.message : 'Unknown error occurred';
				const finalMessage: Message = {
					role: 'assistant',
					content: `Error: ${errorMessage}`,
					streaming: false,
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

								if (msg.role === 'user' && i === messages.length - 1) {
									truncateIndex = i;
									break;
								}

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
			}

			streamingState.setIsStreaming(false);
			streamingState.setAbortController(null);
			streamingState.setStreamTokenCount(0);
		}
	};

	const handleHistorySelect = async (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => {
		streamingState.setContextUsage(null);

		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) return;

		if (
			selectedIndex === 0 &&
			currentSession.compressedFrom !== undefined &&
			currentSession.compressedFrom !== null
		) {
			let totalFileCount = 0;
			for (const [index, count] of snapshotState.snapshotFileCount.entries()) {
				if (index >= selectedIndex) {
					totalFileCount += count;
				}
			}

			if (totalFileCount > 0) {
				const filePaths = await incrementalSnapshotManager.getFilesToRollback(
					currentSession.id,
					selectedIndex,
				);
				snapshotState.setPendingRollback({
					messageIndex: selectedIndex,
					fileCount: filePaths.length,
					filePaths,
					message: cleanIDEContext(message),
					images,
					crossSessionRollback: true,
					originalSessionId: currentSession.compressedFrom,
				});
				return;
			}

			const originalSessionId = currentSession.compressedFrom;

			try {
				const originalSession = await sessionManager.loadSession(
					originalSessionId,
				);
				if (!originalSession) {
					console.error('Failed to load original session for rollback');
				} else {
					sessionManager.setCurrentSession(originalSession);

					const uiMessages = convertSessionMessagesToUI(
						originalSession.messages,
					);

					clearSavedMessages();
					setMessages(uiMessages);
					setRemountKey(prev => prev + 1);

					const snapshots = await incrementalSnapshotManager.listSnapshots(
						originalSession.id,
					);
					const counts = new Map<number, number>();
					for (const snapshot of snapshots) {
						counts.set(snapshot.messageIndex, snapshot.fileCount);
					}
					snapshotState.setSnapshotFileCount(counts);

					console.log(
						`Switched to original session (before compression) with ${originalSession.messageCount} messages`,
					);

					return;
				}
			} catch (error) {
				console.error('Failed to switch to original session:', error);
			}
		}

		let totalFileCount = 0;
		for (const [index, count] of snapshotState.snapshotFileCount.entries()) {
			if (index >= selectedIndex) {
				totalFileCount += count;
			}
		}

		if (totalFileCount > 0) {
			const filePaths = await incrementalSnapshotManager.getFilesToRollback(
				currentSession.id,
				selectedIndex,
			);
			snapshotState.setPendingRollback({
				messageIndex: selectedIndex,
				fileCount: filePaths.length,
				filePaths,
				message: cleanIDEContext(message),
				images,
			});
		} else {
			setRestoreInputContent({
				text: cleanIDEContext(message),
				images: images,
			});
			await performRollback(selectedIndex, false);
		}
	};

	const performRollback = async (
		selectedIndex: number,
		rollbackFiles: boolean,
	) => {
		const currentSession = sessionManager.getCurrentSession();

		if (rollbackFiles && currentSession) {
			await incrementalSnapshotManager.rollbackToMessageIndex(
				currentSession.id,
				selectedIndex,
			);
		}

		if (currentSession) {
			const messagesAfterSelected = messages.slice(selectedIndex);
			const hasDiscontinuedMessage = messagesAfterSelected.some(
				msg => msg.discontinued,
			);

			let uiUserMessagesToDelete = 0;
			if (hasDiscontinuedMessage) {
				uiUserMessagesToDelete = 0;
			} else {
				uiUserMessagesToDelete = messagesAfterSelected.filter(
					msg => msg.role === 'user',
				).length;
			}
			const selectedMessage = messages[selectedIndex];
			const isUncommittedUserMessage =
				selectedMessage?.role === 'user' &&
				uiUserMessagesToDelete === 1 &&
				(selectedIndex === messages.length - 1 ||
					(selectedIndex === messages.length - 2 &&
						messages[messages.length - 1]?.discontinued));

			if (isUncommittedUserMessage) {
				const lastSessionMsg =
					currentSession.messages[currentSession.messages.length - 1];
				const sessionEndsWithAssistant =
					lastSessionMsg?.role === 'assistant' && !lastSessionMsg?.tool_calls;

				if (sessionEndsWithAssistant) {
					setMessages(prev => prev.slice(0, selectedIndex));
					clearSavedMessages();
					snapshotState.setPendingRollback(null);

					setTimeout(() => {
						setRemountKey(prev => prev + 1);
					}, 0);
					return;
				}
			}

			let sessionTruncateIndex = currentSession.messages.length;

			if (selectedIndex === 0) {
				sessionTruncateIndex = 0;
			} else {
				let sessionUserMessageCount = 0;

				for (let i = currentSession.messages.length - 1; i >= 0; i--) {
					const msg = currentSession.messages[i];
					if (msg && msg.role === 'user') {
						sessionUserMessageCount++;
						if (sessionUserMessageCount === uiUserMessagesToDelete) {
							sessionTruncateIndex = i;
							break;
						}
					}
				}
			}

			if (sessionTruncateIndex === 0 && currentSession) {
				await incrementalSnapshotManager.clearAllSnapshots(currentSession.id);

				await sessionManager.deleteSession(currentSession.id);

				sessionManager.clearCurrentSession();

				setMessages([]);

				clearSavedMessages();

				snapshotState.setSnapshotFileCount(new Map());

				snapshotState.setPendingRollback(null);

				setTimeout(() => {
					setRemountKey(prev => prev + 1);
				}, 0);

				return;
			}

			await incrementalSnapshotManager.deleteSnapshotsFromIndex(
				currentSession.id,
				selectedIndex,
			);

			const snapshots = await incrementalSnapshotManager.listSnapshots(
				currentSession.id,
			);
			const counts = new Map<number, number>();
			for (const snapshot of snapshots) {
				counts.set(snapshot.messageIndex, snapshot.fileCount);
			}
			snapshotState.setSnapshotFileCount(counts);

			await sessionManager.truncateMessages(sessionTruncateIndex);
		}

		setMessages(prev => prev.slice(0, selectedIndex));

		clearSavedMessages();

		snapshotState.setPendingRollback(null);

		setTimeout(() => {
			setRemountKey(prev => prev + 1);
		}, 0);
	};

	const handleRollbackConfirm = async (rollbackFiles: boolean | null) => {
		if (rollbackFiles === null) {
			snapshotState.setPendingRollback(null);
			return;
		}

		if (snapshotState.pendingRollback) {
			if (snapshotState.pendingRollback.message) {
				setRestoreInputContent({
					text: snapshotState.pendingRollback.message,
					images: snapshotState.pendingRollback.images,
				});
			}

			if (snapshotState.pendingRollback.crossSessionRollback) {
				const {originalSessionId} = snapshotState.pendingRollback;

				if (rollbackFiles) {
					await performRollback(
						snapshotState.pendingRollback.messageIndex,
						true,
					);
				}

				snapshotState.setPendingRollback(null);

				if (originalSessionId) {
					try {
						const originalSession = await sessionManager.loadSession(
							originalSessionId,
						);
						if (originalSession) {
							sessionManager.setCurrentSession(originalSession);

							const uiMessages = convertSessionMessagesToUI(
								originalSession.messages,
							);

							clearSavedMessages();
							setMessages(uiMessages);
							setRemountKey(prev => prev + 1);

							const snapshots = await incrementalSnapshotManager.listSnapshots(
								originalSession.id,
							);
							const counts = new Map<number, number>();
							for (const snapshot of snapshots) {
								counts.set(snapshot.messageIndex, snapshot.fileCount);
							}
							snapshotState.setSnapshotFileCount(counts);

							console.log(
								`Switched to original session (before compression) with ${originalSession.messageCount} messages`,
							);
						}
					} catch (error) {
						console.error('Failed to switch to original session:', error);
					}
				}
			} else {
				await performRollback(
					snapshotState.pendingRollback.messageIndex,
					rollbackFiles,
				);
			}
		}
	};

	return {
		handleMessageSubmit,
		processMessage: processMessageRef.current!,
		processPendingMessages,
		handleHistorySelect,
		handleRollbackConfirm,
	};
}
