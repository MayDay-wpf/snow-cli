import {useRef} from 'react';
import {useI18n} from '../../i18n/index.js';
import {type Message} from '../../ui/components/chat/MessageList.js';
import type {ReviewCommitSelection} from '../../ui/components/panels/ReviewCommitPanel.js';
import {reviewAgent} from '../../agents/reviewAgent.js';
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
import {vscodeConnection} from '../../utils/ui/vscodeConnection.js';
import {reindexCodebase} from '../../utils/codebase/reindexCodebase.js';

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
	// Session panel handlers
	initializeFromSession: (messages: any[]) => void;
	setShowSessionPanel: (show: boolean) => void;
	setShowReviewCommitPanel: (show: boolean) => void;
	// Quit and reindex handlers
	exitApp: () => void;
	codebaseAgentRef: React.MutableRefObject<any>;
	setCodebaseIndexing: React.Dispatch<React.SetStateAction<boolean>>;
	setCodebaseProgress: React.Dispatch<
		React.SetStateAction<{
			totalFiles: number;
			processedFiles: number;
			totalChunks: number;
			currentFile: string;
			status: string;
			error?: string;
		} | null>
	>;
	setFileUpdateNotification: React.Dispatch<
		React.SetStateAction<{
			file: string;
			timestamp: number;
		} | null>
	>;
	setWatcherEnabled: React.Dispatch<React.SetStateAction<boolean>>;
	exitingApplicationText: string;
}

export function useChatLogic(props: UseChatLogicProps) {
	const {t} = useI18n();
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
		initializeFromSession,
		setShowSessionPanel,
		setShowReviewCommitPanel,
		exitApp,
		codebaseAgentRef,
		setCodebaseIndexing,
		setCodebaseProgress,
		setFileUpdateNotification,
		setWatcherEnabled,
		exitingApplicationText,
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
		if (streamingState.streamStatus !== 'idle') {
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
				// 纯 Bash 模式：执行命令但不发送给 AI。
				// 由于 bash 执行面板只在 isExecuting=true 时显示，命令结束后会消失；
				// 这里把最终结果写入 messages，确保用户能看到输出。
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
				return; // 不继续处理，不发送给 AI
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

		// CRITICAL: Always read from disk to get accurate snapshot info
		// The in-memory snapshotFileCount cache may be stale if files were edited
		// but messagesLength hasn't changed yet (e.g., during streaming)
		const filePaths = await hashBasedSnapshotManager.getFilesToRollback(
			currentSession.id,
			selectedIndex,
		);

		if (filePaths.length > 0) {
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

	const rollbackViaSSE = async (params: {
		serverUrl: string;
		sessionId: string;
		messageIndex: number;
		rollbackFiles: boolean;
		selectedFiles?: string[];
		requestId?: string;
	}) => {
		const response = await fetch(`${params.serverUrl}/message`, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				type: 'rollback',
				sessionId: params.sessionId,
				requestId: params.requestId,
				rollback: {
					messageIndex: params.messageIndex,
					rollbackFiles: params.rollbackFiles,
					selectedFiles: params.selectedFiles,
				},
			}),
		});

		if (!response.ok) {
			let detail: any = undefined;
			try {
				detail = await response.json();
			} catch {
				// ignore
			}
			throw new Error(
				`Rollback request failed: ${response.status} ${response.statusText}` +
					(detail ? ` (${JSON.stringify(detail)})` : ''),
			);
		}
	};

	const handleSessionPanelSelect = async (sessionId: string) => {
		setShowSessionPanel(false);
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				// Convert API format messages to UI format for proper rendering
				const uiMessages = convertSessionMessagesToUI(session.messages);

				initializeFromSession(session.messages);
				setMessages(uiMessages);
				setPendingMessages([]);
				streamingState.setIsStreaming(false);
				setRemountKey(prev => prev + 1);

				// Load snapshot file counts for the loaded session
				const snapshots = await hashBasedSnapshotManager.listSnapshots(
					session.id,
				);
				const counts = new Map<number, number>();
				for (const snapshot of snapshots) {
					counts.set(snapshot.messageIndex, snapshot.fileCount);
				}
				snapshotState.setSnapshotFileCount(counts);

				// Display warning AFTER loading session (if any)
				if (sessionManager.lastLoadHookWarning) {
					console.log(sessionManager.lastLoadHookWarning);
				}
			} else {
				// Session load failed - check if it's due to hook failure
				if (sessionManager.lastLoadHookError) {
					// Display hook error using HookErrorDisplay component
					const errorMessage: Message = {
						role: 'assistant',
						content: '', // Content will be rendered by HookErrorDisplay
						hookError: sessionManager.lastLoadHookError,
					};
					setMessages(prev => [...prev, errorMessage]);
				} else {
					// Generic error
					const errorMessage: Message = {
						role: 'assistant',
						content: 'Failed to load session.',
					};
					setMessages(prev => [...prev, errorMessage]);
				}
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	// Handle quit command - clean up resources and exit application
	const handleQuit = async () => {
		// Show exiting message
		setMessages(prev => [
			...prev,
			{
				role: 'command',
				content: exitingApplicationText,
			},
		]);

		// 设置超时机制，防止卡死
		const quitTimeout = setTimeout(() => {
			// 超时后强制退出
			process.exit(0);
		}, 3000); // 3秒超时

		try {
			// Stop codebase indexing agent with timeout
			if (codebaseAgentRef.current) {
				const agent = codebaseAgentRef.current;
				await Promise.race([
					(async () => {
						await agent.stop();
						agent.stopWatching();
					})(),
					new Promise(resolve => setTimeout(resolve, 2000)), // 2秒超时
				]);
			}

			// Stop VSCode connection (同步操作，不需要超时)
			if (
				vscodeConnection.isConnected() ||
				vscodeConnection.isClientRunning()
			) {
				vscodeConnection.stop();
			}

			// 清除超时计时器
			clearTimeout(quitTimeout);

			// Exit the application
			exitApp();
		} catch (error) {
			// 出现错误时也要清除超时计时器
			clearTimeout(quitTimeout);
			// 强制退出
			process.exit(0);
		}
	};

	const handleReindexCodebase = async (force?: boolean) => {
		const workingDirectory = process.cwd();

		setCodebaseIndexing(true);

		try {
			// Use the reindexCodebase utility function
			const agent = await reindexCodebase(
				workingDirectory,
				codebaseAgentRef.current,
				progressData => {
					setCodebaseProgress({
						totalFiles: progressData.totalFiles,
						processedFiles: progressData.processedFiles,
						totalChunks: progressData.totalChunks,
						currentFile: progressData.currentFile,
						status: progressData.status,
						error: progressData.error,
					});

					if (
						progressData.status === 'completed' ||
						progressData.status === 'error'
					) {
						setCodebaseIndexing(false);
					}
				},
				force,
			);

			// Update the agent reference
			codebaseAgentRef.current = agent;

			// Start file watcher after reindexing is completed
			if (agent) {
				agent.startWatching(watcherProgressData => {
					setCodebaseProgress({
						totalFiles: watcherProgressData.totalFiles,
						processedFiles: watcherProgressData.processedFiles,
						totalChunks: watcherProgressData.totalChunks,
						currentFile: watcherProgressData.currentFile,
						status: watcherProgressData.status,
						error: watcherProgressData.error,
					});

					if (
						watcherProgressData.totalFiles === 0 &&
						watcherProgressData.currentFile
					) {
						setFileUpdateNotification({
							file: watcherProgressData.currentFile,
							timestamp: Date.now(),
						});

						setTimeout(() => {
							setFileUpdateNotification(null);
						}, 3000);
					}
				});
				setWatcherEnabled(true);
			}
		} catch (error) {
			setCodebaseIndexing(false);
			throw error;
		}
	};

	// Handle toggle codebase command
	const handleToggleCodebase = async (mode?: string) => {
		const workingDirectory = process.cwd();
		const {loadCodebaseConfig, saveCodebaseConfig} = await import(
			'../../utils/config/codebaseConfig.js'
		);

		const config = loadCodebaseConfig(workingDirectory);

		// Determine new enabled state
		let newEnabled: boolean;
		if (mode === 'on') {
			newEnabled = true;
		} else if (mode === 'off') {
			newEnabled = false;
		} else {
			// Toggle
			newEnabled = !config.enabled;
		}

		// Update config
		config.enabled = newEnabled;
		saveCodebaseConfig(config, workingDirectory);

		// Show message
		const statusMessage: Message = {
			role: 'command',
			content: `Codebase indexing ${
				newEnabled ? 'enabled' : 'disabled'
			} for this project`,
			commandName: 'codebase',
		};
		setMessages(prev => [...prev, statusMessage]);

		// If enabling, start indexing
		if (newEnabled) {
			await handleReindexCodebase();
		} else {
			// If disabling, stop the agent
			if (codebaseAgentRef.current) {
				await codebaseAgentRef.current.stop();
				codebaseAgentRef.current.stopWatching();
				codebaseAgentRef.current = null;
				setCodebaseIndexing(false);
				setWatcherEnabled(false);
			}
		}
	};

	const handleReviewCommitConfirm = async (
		selection: ReviewCommitSelection[],
		notes: string,
	) => {
		// Close panel immediately to restore input/viewport
		setShowReviewCommitPanel(false);

		try {
			const gitCheck = reviewAgent.checkGitRepository();
			if (!gitCheck.isGitRepo || !gitCheck.gitRoot) {
				throw new Error(gitCheck.error || 'Not a git repository');
			}

			const gitRoot = gitCheck.gitRoot;
			const parts: string[] = [];

			for (const item of selection) {
				if (item.type === 'staged') {
					const diff = reviewAgent.getStagedDiff(gitRoot);
					parts.push(diff);
				} else if (item.type === 'unstaged') {
					const diff = reviewAgent.getUnstagedDiff(gitRoot);
					parts.push(diff);
				} else {
					const patch = reviewAgent.getCommitPatch(gitRoot, item.sha);
					parts.push(patch);
				}
			}

			const combined = parts
				.map(p => p.trim())
				.filter(Boolean)
				.join('\n\n');
			if (!combined) {
				throw new Error(
					'No changes detected. Please make some changes before running code review.',
				);
			}

			const notesBlock = notes.trim()
				? `\n\n**User's Additional Notes:**\n${notes.trim()}\n`
				: '';

			const prompt = `You are a senior code reviewer. Please review the following git changes and provide feedback.

**Your task:**
1. Identify potential bugs, security issues, or logic errors
2. Suggest performance optimizations
3. Point out code quality issues (readability, maintainability)
4. Check for best practices violations
5. Highlight any breaking changes or compatibility issues

**Important:**
- DO NOT modify the code yourself
- Focus on finding issues and suggesting improvements
- Ask the user if they want to fix any issues you find
- Be constructive and specific in your feedback
- Prioritize critical issues over minor style preferences${notesBlock}
**Git Changes:**

\`\`\`diff
${combined}
\`\`\`

Please provide your review in a clear, structured format.`;

			sessionManager.clearCurrentSession();
			clearSavedMessages();
			setMessages([]);
			setRemountKey(prev => prev + 1);
			streamingState.setContextUsage(null);

			const selectedWorkingTree = selection.some(
				s => s.type === 'staged' || s.type === 'unstaged',
			);
			const selectedCommits = selection.filter(s => s.type === 'commit');
			const commitShas = selectedCommits.map(s => s.sha).filter(Boolean);
			const shortCommitList = commitShas
				.slice(0, 6)
				.map(sha => sha.slice(0, 8))
				.join(', ');

			const selectedSummary = t.chatScreen.reviewSelectedSummary
				.replace(
					'{workingTreePrefix}',
					selectedWorkingTree
						? t.chatScreen.reviewSelectedWorkingTreePrefix
						: '',
				)
				.replace('{commitCount}', selectedCommits.length.toString());

			const commandLines: string[] = [
				t.chatScreen.reviewStartTitle,
				selectedSummary,
			];

			if (commitShas.length > 0) {
				const moreSuffix =
					commitShas.length > 6
						? t.chatScreen.reviewCommitsMoreSuffix.replace(
								'{commitCount}',
								commitShas.length.toString(),
						  )
						: '';
				commandLines.push(
					t.chatScreen.reviewCommitsLine
						.replace('{commitList}', shortCommitList)
						.replace('{moreSuffix}', moreSuffix),
				);
			}

			if (notes.trim()) {
				commandLines.push(
					t.chatScreen.reviewNotesLine.replace('{notes}', notes.trim()),
				);
			}

			commandLines.push(t.chatScreen.reviewGenerating);
			commandLines.push(t.chatScreen.reviewInterruptHint);

			const commandMessage: Message = {
				role: 'command',
				content: commandLines.join('\n'),
				commandName: 'review',
			};
			setMessages([commandMessage]);

			await processMessage(prompt, undefined, false, true);
		} catch (error) {
			const errorMsg =
				error instanceof Error ? error.message : 'Failed to start review';
			const errorMessage: Message = {
				role: 'command',
				content: errorMsg,
				commandName: 'review',
			};
			setMessages(prev => [...prev, errorMessage]);
		}
	};

	return {
		handleMessageSubmit,
		processMessage: processMessageRef.current!,
		processPendingMessages,
		handleHistorySelect,
		handleRollbackConfirm,
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleToggleCodebase,
		handleReviewCommitConfirm,
		rollbackViaSSE,
	};
}
