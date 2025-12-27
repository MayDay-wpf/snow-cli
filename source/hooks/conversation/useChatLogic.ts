import {useRef} from 'react';
import {type Message} from '../../ui/components/chat/MessageList.js';
import {sessionManager} from '../../utils/session/sessionManager.js';
import {handleConversationWithTools} from './useConversation.js';
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
import {hashBasedSnapshotManager} from '../../utils/codebase/hashBasedSnapshot.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';

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
	pendingUserQuestion: {
		question: string;
		options: string[];
		toolCall: any;
		resolve: (result: {
			selected: string | string[];
			customInput?: string;
			cancelled?: boolean;
		}) => void;
	} | null;
	setPendingUserQuestion: React.Dispatch<
		React.SetStateAction<{
			question: string;
			options: string[];
			toolCall: any;
			resolve: (result: {
				selected: string | string[];
				customInput?: string;
				cancelled?: boolean;
			}) => void;
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
		pendingUserQuestion,
		setPendingUserQuestion,
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

		await processMessage(message, images);
	};

	// Handle user question answer
	const handleUserQuestionAnswer = (result: {
		selected: string | string[];
		customInput?: string;
		cancelled?: boolean;
	}) => {
		if (pendingUserQuestion) {
			// 如果用户选择取消，先resolve Promise让工具执行器继续，然后触发中断
			if (result.cancelled) {
				// 先清空pendingUserQuestion，确保LoadingIndicator可以显示
				const resolver = pendingUserQuestion.resolve;
				setPendingUserQuestion(null);

				// 标记用户手动中断（关键：让finally块能清除停止状态）
				userInterruptedRef.current = true;

				// 设置停止状态
				streamingState.setIsStopping(true);

				// 然后resolve Promise，传递cancelled标志
				resolver(result);

				// 中止AbortController（工具执行器会检测到cancelled并抛出错误）
				if (streamingState.abortController) {
					streamingState.abortController.abort();
				}

				// 清空pending状态
				setMessages(prev => prev.filter(msg => !msg.toolPending));
				setPendingMessages([]);

				return;
			}

			//直接传递结果，保留数组形式用于多选
			pendingUserQuestion.resolve(result);
			setPendingUserQuestion(null);
		}
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

		// NOTE: New on-demand backup system - files are automatically backed up when modified
		// No need for manual snapshot creation

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
					});
				} else {
					await saveMessage(msg);
				}
			};

			try {
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
					getCurrentContextPercentage: () =>
						currentContextPercentageRef.current,
					setCurrentModel: streamingState.setCurrentModel,
				});
			} finally {
				// NOTE: New on-demand backup system - snapshot management is now automatic
				// Files are backed up when they are created/modified
				// No need for manual commit process
			}
		} catch (error) {
			// Don't show error message if user manually interrupted or request was aborted
			if (!controller.signal.aborted && !userInterruptedRef.current) {
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

								// 检查是否有未完成的 tool_calls
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

				// Clear stopping state after discontinued message is added
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

			try {
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
					getCurrentContextPercentage: () =>
						currentContextPercentageRef.current,
					setCurrentModel: streamingState.setCurrentModel,
				});
			} finally {
				// Snapshots are now created on-demand during file operations
				// No global commit needed
			}
		} catch (error) {
			// Don't show error message if user manually interrupted or request was aborted
			if (!controller.signal.aborted && !userInterruptedRef.current) {
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

								// 检查是否有未完成的 tool_calls
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

				// Clear stopping state after discontinued message is added
				streamingState.setIsStopping(false);
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
				const filePaths = await hashBasedSnapshotManager.getFilesToRollback(
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

					const snapshots = await hashBasedSnapshotManager.listSnapshots(
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
			const filePaths = await hashBasedSnapshotManager.getFilesToRollback(
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
		selectedFiles?: string[],
	) => {
		const currentSession = sessionManager.getCurrentSession();

		if (rollbackFiles && currentSession) {
			if (selectedFiles && selectedFiles.length > 0) {
				// Partial rollback - only rollback selected files
				await hashBasedSnapshotManager.rollbackToMessageIndex(
					currentSession.id,
					selectedIndex,
					selectedFiles,
				);
			} else {
				// Full rollback - rollback all files
				await hashBasedSnapshotManager.rollbackToMessageIndex(
					currentSession.id,
					selectedIndex,
				);
			}
		}

		if (currentSession) {
			const messagesAfterSelected = messages.slice(selectedIndex);
			const uiUserMessagesToDelete = messagesAfterSelected.filter(
				msg => msg.role === 'user',
			).length;
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

					setTimeout(() => {
						setRemountKey(prev => prev + 1);
						snapshotState.setPendingRollback(null);
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
				await hashBasedSnapshotManager.clearAllSnapshots(currentSession.id);

				await sessionManager.deleteSession(currentSession.id);

				sessionManager.clearCurrentSession();

				setMessages([]);

				clearSavedMessages();

				snapshotState.setSnapshotFileCount(new Map());

				setTimeout(() => {
					setRemountKey(prev => prev + 1);
					snapshotState.setPendingRollback(null);
				}, 0);

				return;
			}

			await hashBasedSnapshotManager.deleteSnapshotsFromIndex(
				currentSession.id,
				selectedIndex,
			);

			const snapshots = await hashBasedSnapshotManager.listSnapshots(
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

		setTimeout(() => {
			setRemountKey(prev => prev + 1);
			snapshotState.setPendingRollback(null);
		}, 0);
	};

	const handleRollbackConfirm = async (
		rollbackFiles: boolean | null,
		selectedFiles?: string[],
	) => {
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
						selectedFiles,
					);
				}

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

							const snapshots = await hashBasedSnapshotManager.listSnapshots(
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

							setTimeout(() => {
								setRemountKey(prev => prev + 1);
								snapshotState.setPendingRollback(null);
							}, 0);
						}
					} catch (error) {
						console.error('Failed to switch to original session:', error);
						snapshotState.setPendingRollback(null);
					}
				} else {
					snapshotState.setPendingRollback(null);
				}
			} else {
				await performRollback(
					snapshotState.pendingRollback.messageIndex,
					rollbackFiles,
					selectedFiles,
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
		handleUserQuestionAnswer,
	};
}
