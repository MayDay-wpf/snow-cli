import {useEffect, useRef, useState} from 'react';
import {CodebaseIndexAgent} from '../../../agents/codebaseIndexAgent.js';
import {validateGitignore} from '../../../utils/codebase/gitignoreValidator.js';
import {loadCodebaseConfig} from '../../../utils/config/codebaseConfig.js';
import {logger} from '../../../utils/core/logger.js';
import type {
	CodebaseProgressState,
	FileUpdateNotificationState,
} from './types.js';

type ProgressData = NonNullable<CodebaseProgressState>;

function toProgressState(progressData: ProgressData): ProgressData {
	return {
		totalFiles: progressData.totalFiles,
		processedFiles: progressData.processedFiles,
		totalChunks: progressData.totalChunks,
		currentFile: progressData.currentFile,
		status: progressData.status,
		error: progressData.error,
	};
}

export function useCodebaseIndexing(workingDirectory: string) {
	const [codebaseIndexing, setCodebaseIndexing] = useState(false);
	const [codebaseProgress, setCodebaseProgress] =
		useState<CodebaseProgressState>(null);
	const [watcherEnabled, setWatcherEnabled] = useState(false);
	const [fileUpdateNotification, setFileUpdateNotification] =
		useState<FileUpdateNotificationState>(null);
	const codebaseAgentRef = useRef<CodebaseIndexAgent | null>(null);

	useEffect(() => {
		const notifyFileUpdate = (file: string) => {
			setFileUpdateNotification({
				file,
				timestamp: Date.now(),
			});

			setTimeout(() => {
				setFileUpdateNotification(null);
			}, 3000);
		};

		const syncProgress = (progressData: ProgressData) => {
			setCodebaseProgress(toProgressState(progressData));

			if (progressData.totalFiles === 0 && progressData.currentFile) {
				notifyFileUpdate(progressData.currentFile);
			}
		};

		const startCodebaseIndexing = async () => {
			try {
				const config = loadCodebaseConfig();

				if (!config.enabled) {
					if (codebaseAgentRef.current) {
						logger.info('Codebase feature disabled, stopping agent');
						await codebaseAgentRef.current.stop();
						codebaseAgentRef.current.stopWatching();
						codebaseAgentRef.current = null;
						setCodebaseIndexing(false);
						setWatcherEnabled(false);
					}

					return;
				}

				const validation = validateGitignore(workingDirectory);
				if (!validation.isValid) {
					setCodebaseProgress({
						totalFiles: 0,
						processedFiles: 0,
						totalChunks: 0,
						currentFile: '',
						status: 'error',
						error: validation.error,
					});
					setWatcherEnabled(false);
					logger.error(validation.error || 'Validation error');
					return;
				}

				const agent = new CodebaseIndexAgent(workingDirectory);
				codebaseAgentRef.current = agent;

				const progress = await agent.getProgress();
				if (progress.status === 'completed' && progress.totalChunks > 0) {
					agent.startWatching(syncProgress);
					setWatcherEnabled(true);
					return;
				}

				const wasWatcherEnabled = await agent.isWatcherEnabled();
				if (wasWatcherEnabled) {
					logger.info('Restoring file watcher from previous session');
					agent.startWatching(syncProgress);
					setWatcherEnabled(true);
					setCodebaseIndexing(false);
				}

				setCodebaseIndexing(true);
				agent.start(progressData => {
					syncProgress(progressData);

					if (
						progressData.status === 'completed' ||
						progressData.status === 'error'
					) {
						setCodebaseIndexing(false);

						if (progressData.status === 'completed') {
							agent.startWatching(syncProgress);
							setWatcherEnabled(true);
						}
					}
				});
			} catch (error) {
				console.error('Failed to start codebase indexing:', error);
				setCodebaseIndexing(false);
			}
		};

		startCodebaseIndexing();

		return () => {
			if (codebaseAgentRef.current) {
				codebaseAgentRef.current.stop();
				codebaseAgentRef.current.stopWatching();
				setWatcherEnabled(false);
			}
		};
	}, [workingDirectory]);

	useEffect(() => {
		(global as any).__stopCodebaseIndexing = async () => {
			if (codebaseAgentRef.current) {
				await codebaseAgentRef.current.stop();
				codebaseAgentRef.current.stopWatching();
				setCodebaseIndexing(false);
				setWatcherEnabled(false);
				setCodebaseProgress(null);
			}
		};

		return () => {
			delete (global as any).__stopCodebaseIndexing;
		};
	}, []);

	return {
		codebaseIndexing,
		setCodebaseIndexing,
		codebaseProgress,
		setCodebaseProgress,
		watcherEnabled,
		setWatcherEnabled,
		fileUpdateNotification,
		setFileUpdateNotification,
		codebaseAgentRef,
	};
}
