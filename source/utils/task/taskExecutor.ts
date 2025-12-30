import {spawn} from 'child_process';
import {taskManager} from './taskManager.js';
import {writeFileSync, appendFileSync, existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import {homedir} from 'os';

const TASK_LOG_DIR = join(homedir(), '.snow', 'task-logs');

function ensureLogDir() {
	if (!existsSync(TASK_LOG_DIR)) {
		mkdirSync(TASK_LOG_DIR, {recursive: true});
	}
}

function getLogPath(taskId: string): string {
	ensureLogDir();
	return join(TASK_LOG_DIR, `${taskId}.log`);
}

function writeLog(taskId: string, message: string) {
	try {
		const logPath = getLogPath(taskId);
		const timestamp = new Date().toISOString();
		appendFileSync(logPath, `[${timestamp}] ${message}\n`, 'utf-8');
	} catch (error) {
		// Fail silently - don't break task execution
	}
}

export async function executeTaskInBackground(
	taskId: string,
	prompt: string,
): Promise<void> {
	// Use process.argv[0] (node) and process.argv[1] (current script)
	const cliPath = process.argv[1] || '';
	const logPath = getLogPath(taskId);

	// Initialize log file
	ensureLogDir();
	writeFileSync(logPath, `Task ${taskId} execution log\n`, 'utf-8');
	writeLog(
		taskId,
		`Starting background task with prompt: ${prompt.slice(0, 100)}...`,
	);
	writeLog(taskId, `CLI path: ${cliPath}`);
	writeLog(taskId, `Node: ${process.execPath}`);

	// Spawn a detached background process with log file output
	const child = spawn(
		process.execPath,
		[cliPath, '--task-execute', taskId, '--', prompt],
		{
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				SNOW_TASK_MODE: 'true',
				SNOW_TASK_ID: taskId,
			},
		},
	);

	// Capture stdout and stderr to log file
	if (child.stdout) {
		child.stdout.on('data', data => {
			writeLog(taskId, `[STDOUT] ${data.toString()}`);
		});
	}
	if (child.stderr) {
		child.stderr.on('data', data => {
			writeLog(taskId, `[STDERR] ${data.toString()}`);
		});
	}

	child.on('error', error => {
		writeLog(taskId, `[ERROR] Child process error: ${error.message}`);
	});

	child.on('exit', (code, signal) => {
		writeLog(
			taskId,
			`[EXIT] Process exited with code ${code}, signal ${signal}`,
		);
	});

	// Save the PID to the task for process management
	if (child.pid) {
		try {
			const task = await taskManager.loadTask(taskId);
			if (task) {
				task.pid = child.pid;
				await taskManager.saveTask(task);
			}
		} catch (error) {
			writeLog(taskId, `Failed to save PID: ${error}`);
		}
	}

	// Detach the child process so parent can exit
	child.unref();

	console.log(`Task ${taskId} started in background (PID: ${child.pid})`);
	console.log(`Logs: ${logPath}`);
}

export async function executeTask(
	taskId: string,
	prompt: string,
): Promise<void> {
	const log = (message: string) => {
		const msg = `[executeTask] ${message}`;
		// Don't use console.log in detached process - only write to file
		writeLog(taskId, msg);
	};

	// Setup global error handlers to catch unhandled rejections
	process.on('unhandledRejection', (reason, promise) => {
		log(`Unhandled Promise Rejection: ${reason}`);
		log(`Promise: ${JSON.stringify(promise)}`);
	});

	process.on('uncaughtException', error => {
		log(`Uncaught Exception: ${error.message}`);
		log(`Stack: ${error.stack}`);
		process.exit(1);
	});

	try {
		log(`Task ${taskId} execution started`);
		log(`Prompt: ${prompt.slice(0, 100)}...`);

		// Update task status to running
		log('Updating task status to running...');
		await taskManager.updateTaskStatus(taskId, 'running');
		log('Task status updated to running');

		// Dynamically import heavy dependencies
		log('Loading dependencies...');
		const [
			{parseAndValidateFileReferences, createMessageWithFileInstructions},
			{handleConversationWithTools},
		] = await Promise.all([
			import('../core/fileUtils.js'),
			import('../../hooks/conversation/useConversation.js'),
		]);
		log('Dependencies loaded successfully');

		// Create mock state for headless execution
		const streamingState = {
			isStreaming: false,
			isReasoning: false,
			elapsedSeconds: 0,
			streamTokenCount: 0,
			retryStatus: null,
			setIsStreaming: () => {},
			setIsReasoning: () => {},
			setStreamTokenCount: () => {},
			setContextUsage: () => {},
			setAbortController: () => {},
			setRetryStatus: () => {},
		};

		const vscodeState = {
			vscodeConnected: false,
			editorContext: undefined,
		};

		const savedMessageIds = new Set<string>();
		const saveMessageToTask = async (message: any) => {
			// Generate unique ID for deduplication
			const msgId = `${message.role}-${message.content?.slice(0, 50)}-${
				message.tool_calls?.[0]?.id || ''
			}`;
			if (savedMessageIds.has(msgId)) {
				return;
			}
			savedMessageIds.add(msgId);

			await taskManager.addMessage(taskId, {
				...message,
				timestamp: Date.now(),
			});
		};

		// Parse prompt
		log('Parsing prompt and file references...');
		const {cleanContent, validFiles} = await parseAndValidateFileReferences(
			prompt,
		);
		const regularFiles = validFiles.filter(f => !f.isImage);
		log(
			`Parsed prompt. Clean content length: ${cleanContent.length}, Files: ${validFiles.length}`,
		);

		const controller = new AbortController();
		const messages: any[] = [];

		const messageForAI = createMessageWithFileInstructions(
			cleanContent,
			regularFiles,
			vscodeState.editorContext,
		);
		log(`Message for AI prepared. Length: ${messageForAI.content.length}`);

		// Execute conversation
		log('Starting conversation with Claude API...');
		try {
			await handleConversationWithTools({
				userContent: messageForAI.content,
				imageContents: [],
				controller,
				messages,
				saveMessage: saveMessageToTask,
				setMessages: (msgsOrUpdater: any) => {
					// Handle both direct array and updater function
					if (typeof msgsOrUpdater === 'function') {
						const newMessages = msgsOrUpdater(messages);
						messages.length = 0;
						messages.push(...newMessages);
					} else {
						messages.length = 0;
						messages.push(...msgsOrUpdater);
					}
				},
				setStreamTokenCount: streamingState.setStreamTokenCount,
				requestToolConfirmation: async toolCall => {
					log('requestToolConfirmation called');
					log(
						`Tool: ${toolCall.function.name}, Args: ${toolCall.function.arguments}`,
					);

					if (toolCall.function.name === 'terminal-execute') {
						const args = JSON.parse(toolCall.function.arguments);
						const command = args?.command || '';
						const {isSensitiveCommand} = await import(
							'../execution/sensitiveCommandManager.js'
						);
						const checkResult = isSensitiveCommand(command);

						if (checkResult.isSensitive) {
							log(`Sensitive command detected: ${command}`);
							log(`Description: ${checkResult.matchedCommand?.description}`);

							await taskManager.pauseTaskForSensitiveCommand(taskId, {
								command,
								description: checkResult.matchedCommand?.description,
								toolCallId: toolCall.id,
								toolName: toolCall.function.name,
								args,
							});

							log('Task paused, waiting for user approval...');

							// Wait a bit to ensure the paused status is persisted
							// This prevents concurrent addMessage calls from overwriting the status
							await new Promise(resolve => setTimeout(resolve, 500));

							// Verify the paused status was saved correctly
							let verifyTask = await taskManager.loadTask(taskId);
							if (verifyTask && verifyTask.status !== 'paused') {
								log('Paused status was overwritten, forcing re-save...');
								verifyTask.status = 'paused';
								if (!verifyTask.pausedInfo) {
									verifyTask.pausedInfo = {
										reason: 'sensitive_command',
										sensitiveCommand: {
											command,
											description: checkResult.matchedCommand?.description,
											toolCallId: toolCall.id,
											toolName: toolCall.function.name,
											args,
										},
										pausedAt: Date.now(),
									};
								}
								await taskManager.saveTask(verifyTask);
								log('Paused status re-saved successfully');
							}

							const pollInterval = 2000;
							const maxWaitTime = 3600000;
							const startTime = Date.now();

							while (true) {
								await new Promise(resolve => setTimeout(resolve, pollInterval));

								if (Date.now() - startTime > maxWaitTime) {
									log('Approval timeout, rejecting command');
									return 'reject' as const;
								}

								const currentTask = await taskManager.loadTask(taskId);
								if (!currentTask) {
									log('Task not found, rejecting');
									return 'reject' as const;
								}

								if (currentTask.status === 'running') {
									const rejectionReason =
										currentTask.pausedInfo?.sensitiveCommand?.rejectionReason;
									if (rejectionReason) {
										log(`User rejected with reason: ${rejectionReason}`);
										delete currentTask.pausedInfo;
										await taskManager.saveTask(currentTask);

										return {
											type: 'reject_with_reply',
											reason: rejectionReason,
										};
									} else {
										log('User approved, continuing execution');
										return 'approve' as const;
									}
								} else if (currentTask.status === 'failed') {
									log('Task failed during approval wait, rejecting');
									return 'reject' as const;
								}
							}
						}
					}

					return 'approve' as const;
				},
				requestUserQuestion: async () => {
					throw new Error('askuser tool is not supported in task mode');
				},
				isToolAutoApproved: () => true,
				addMultipleToAlwaysApproved: () => {},
				yoloMode: true,
				setContextUsage: streamingState.setContextUsage,
				useBasicModel: false,
				getPendingMessages: () => [],
				clearPendingMessages: () => {},
				setIsStreaming: streamingState.setIsStreaming,
				setIsReasoning: streamingState.setIsReasoning,
				setRetryStatus: streamingState.setRetryStatus,
			});
			log('Conversation completed successfully');
		} catch (conversationError) {
			log(
				`Error in handleConversationWithTools: ${
					conversationError instanceof Error
						? conversationError.message
						: String(conversationError)
				}`,
			);
			log(
				`Stack: ${
					conversationError instanceof Error ? conversationError.stack : 'N/A'
				}`,
			);
			throw conversationError; // Re-throw to be caught by outer catch
		}

		log('Conversation completed. Waiting for all message saves to finish...');
		// Wait a bit to ensure all async message saves have completed
		await new Promise(resolve => setTimeout(resolve, 500));

		log('Updating task status to completed...');
		await taskManager.updateTaskStatus(taskId, 'completed');

		// Clear PID since task is completed
		const completedTask = await taskManager.loadTask(taskId);
		if (completedTask) {
			delete completedTask.pid;
			await taskManager.saveTask(completedTask);
		}

		log('Task execution finished successfully');

		// Verify status update
		const finalTask = await taskManager.loadTask(taskId);
		log(`Final task status: ${finalTask?.status}`);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		const stack = error instanceof Error ? error.stack : '';
		log(`Task execution failed: ${errorMessage}`);
		log(`Stack trace: ${stack}`);
		await taskManager.updateTaskStatus(taskId, 'failed', errorMessage);

		// Clear PID since task is failed
		const failedTask = await taskManager.loadTask(taskId);
		if (failedTask) {
			delete failedTask.pid;
			await taskManager.saveTask(failedTask);
		}

		// Don't use console in detached process - errors already logged to file
	}
}
