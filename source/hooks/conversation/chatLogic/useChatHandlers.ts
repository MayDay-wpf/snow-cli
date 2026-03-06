import {useI18n} from '../../../i18n/index.js';
import type {UseChatLogicProps, Message} from './types.js';
import type {ReviewCommitSelection} from '../../../ui/components/panels/ReviewCommitPanel.js';
import {reviewAgent} from '../../../agents/reviewAgent.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';
import {vscodeConnection} from '../../../utils/ui/vscodeConnection.js';
import {reindexCodebase} from '../../../utils/codebase/reindexCodebase.js';

interface UseChatHandlersDeps {
	processMessage: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
		useBasicModel?: boolean,
		hideUserMessage?: boolean,
	) => Promise<void>;
}

export function useChatHandlers(props: UseChatLogicProps, deps: UseChatHandlersDeps) {
	const {t} = useI18n();
	const {
		setMessages,
		setPendingMessages,
		streamingState,
		snapshotState,
		clearSavedMessages,
		setRemountKey,
		pendingUserQuestion,
		setPendingUserQuestion,
		userInterruptedRef,
		initializeFromSession,
		setShowSessionPanel,
		setShowReviewCommitPanel,
		codebaseAgentRef,
		setCodebaseIndexing,
		setCodebaseProgress,
		setFileUpdateNotification,
		setWatcherEnabled,
		exitingApplicationText,
	} = props;
	const {processMessage} = deps;

	const handleUserQuestionAnswer = (result: {
		selected: string | string[];
		customInput?: string;
		cancelled?: boolean;
	}) => {
		if (pendingUserQuestion) {
			if (result.cancelled) {
				const resolver = pendingUserQuestion.resolve;
				setPendingUserQuestion(null);

				userInterruptedRef.current = true;

				streamingState.setIsStopping(true);

				resolver(result);

				if (streamingState.abortController) {
					streamingState.abortController.abort();
				}

				setPendingMessages([]);

				return;
			}

			pendingUserQuestion.resolve(result);
			setPendingUserQuestion(null);
		}
	};

	const handleSessionPanelSelect = async (sessionId: string) => {
		setShowSessionPanel(false);
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				const uiMessages = convertSessionMessagesToUI(session.messages);

				initializeFromSession(session.messages);
				setMessages(uiMessages);
				setPendingMessages([]);
				streamingState.setIsStreaming(false);
				setRemountKey(prev => prev + 1);

				const snapshots = await hashBasedSnapshotManager.listSnapshots(
					session.id,
				);
				const counts = new Map<number, number>();
				for (const snapshot of snapshots) {
					counts.set(snapshot.messageIndex, snapshot.fileCount);
				}
				snapshotState.setSnapshotFileCount(counts);

				if (sessionManager.lastLoadHookWarning) {
					console.log(sessionManager.lastLoadHookWarning);
				}
			} else {
				if (sessionManager.lastLoadHookError) {
					const errorMessage: Message = {
						role: 'assistant',
						content: '',
						hookError: sessionManager.lastLoadHookError,
					};
					setMessages(prev => [...prev, errorMessage]);
				} else {
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

	const handleQuit = async () => {
		setMessages(prev => [
			...prev,
			{
				role: 'command',
				content: exitingApplicationText,
			},
		]);

		const quitTimeout = setTimeout(() => {
			process.exit(0);
		}, 3000);

		try {
			if (codebaseAgentRef.current) {
				const agent = codebaseAgentRef.current;
				await Promise.race([
					(async () => {
						await agent.stop();
						agent.stopWatching();
					})(),
					new Promise(resolve => setTimeout(resolve, 2000)),
				]);
			}

			if (
				vscodeConnection.isConnected() ||
				vscodeConnection.isClientRunning()
			) {
				vscodeConnection.stop();
			}

			clearTimeout(quitTimeout);

			process.exit(0);
		} catch (error) {
			clearTimeout(quitTimeout);
			process.exit(0);
		}
	};

	const handleReindexCodebase = async (force?: boolean) => {
		const workingDirectory = process.cwd();

		setCodebaseIndexing(true);

		try {
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

			codebaseAgentRef.current = agent;

			if (agent) {
				agent.startWatching((watcherProgressData: any) => {
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

	const handleToggleCodebase = async (mode?: string) => {
		const workingDirectory = process.cwd();
		const {loadCodebaseConfig, saveCodebaseConfig} = await import(
			'../../../utils/config/codebaseConfig.js'
		);

		const config = loadCodebaseConfig(workingDirectory);

		let newEnabled: boolean;
		if (mode === 'on') {
			newEnabled = true;
		} else if (mode === 'off') {
			newEnabled = false;
		} else {
			newEnabled = !config.enabled;
		}

		config.enabled = newEnabled;
		saveCodebaseConfig(config, workingDirectory);

		const statusMessage: Message = {
			role: 'command',
			content: newEnabled
				? t.chatScreen.codebaseIndexingEnabled
				: t.chatScreen.codebaseIndexingDisabled,
			commandName: 'codebase',
		};
		setMessages(prev => [...prev, statusMessage]);

		if (newEnabled) {
			await handleReindexCodebase();
		} else {
			if (codebaseAgentRef.current) {
				await codebaseAgentRef.current.stop();
				codebaseAgentRef.current.stopWatching();
				codebaseAgentRef.current = null;
			}

			setCodebaseIndexing(false);
			setWatcherEnabled(false);
			setCodebaseProgress(null);
			setFileUpdateNotification(null);
		}
	};

	const handleReviewCommitConfirm = async (
		selection: ReviewCommitSelection[],
		notes: string,
	) => {
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
		handleUserQuestionAnswer,
		handleSessionPanelSelect,
		handleQuit,
		handleReindexCodebase,
		handleToggleCodebase,
		handleReviewCommitConfirm,
	};
}
