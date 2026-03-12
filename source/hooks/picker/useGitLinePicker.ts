import {useCallback, useEffect, useMemo, useState} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {reviewAgent} from '../../agents/reviewAgent.js';

export type GitLineCommit = {
	sha: string;
	subject: string;
	authorName: string;
	dateIso: string;
};

const PAGE_SIZE = 30;

function buildInjectedGitLineText(
	commit: GitLineCommit,
	gitRoot: string,
): string {
	const patch = reviewAgent.getCommitPatch(gitRoot, commit.sha).trim();

	return [
		`# GitLine: ${commit.sha}`,
		`Commit: ${commit.sha}`,
		`Author: ${commit.authorName}`,
		`Date: ${commit.dateIso}`,
		`Subject: ${commit.subject}`,
		'',
		'```git',
		patch,
		'```',
		'# GitLine End',
		'',
	].join('\n');
}

export function useGitLinePicker(
	buffer: TextBuffer,
	triggerUpdate: () => void,
) {
	const [showGitLinePicker, setShowGitLinePicker] = useState(false);
	const [gitLineSelectedIndex, setGitLineSelectedIndex] = useState(0);
	const [commits, setCommits] = useState<GitLineCommit[]>([]);
	const [selectedCommits, setSelectedCommits] = useState<Set<string>>(
		new Set(),
	);
	const [isLoading, setIsLoading] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [hasMore, setHasMore] = useState(true);
	const [skip, setSkip] = useState(0);
	const [searchQuery, setSearchQuery] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [gitRoot, setGitRoot] = useState<string | null>(null);

	const filteredCommits = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) {
			return commits;
		}

		return commits.filter(commit => {
			return (
				commit.sha.toLowerCase().includes(query) ||
				commit.subject.toLowerCase().includes(query) ||
				commit.authorName.toLowerCase().includes(query) ||
				commit.dateIso.toLowerCase().includes(query)
			);
		});
	}, [commits, searchQuery]);

	const loadFirstPage = useCallback(async () => {
		setIsLoading(true);
		setIsLoadingMore(false);
		setError(null);

		try {
			const gitCheck = reviewAgent.checkGitRepository();
			if (!gitCheck.isGitRepo || !gitCheck.gitRoot) {
				setGitRoot(null);
				setCommits([]);
				setHasMore(false);
				setSkip(0);
				setError(gitCheck.error || 'Not a git repository');
				return;
			}

			const result = reviewAgent.listCommitsPaginated(
				gitCheck.gitRoot,
				0,
				PAGE_SIZE,
			);
			setGitRoot(gitCheck.gitRoot);
			setCommits(result.commits);
			setHasMore(result.hasMore);
			setSkip(result.nextSkip);
			setError(null);
		} catch (loadError) {
			setGitRoot(null);
			setCommits([]);
			setHasMore(false);
			setSkip(0);
			setError(
				loadError instanceof Error
					? loadError.message
					: 'Failed to load git commits',
			);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const loadMoreGitLineCommits = useCallback(async () => {
		if (!gitRoot || isLoading || isLoadingMore || !hasMore) {
			return;
		}

		setIsLoadingMore(true);
		try {
			const result = reviewAgent.listCommitsPaginated(gitRoot, skip, PAGE_SIZE);
			setCommits(prev => [...prev, ...result.commits]);
			setHasMore(result.hasMore);
			setSkip(result.nextSkip);
			setError(null);
		} catch (loadError) {
			setError(
				loadError instanceof Error
					? loadError.message
					: 'Failed to load more git commits',
			);
		} finally {
			setIsLoadingMore(false);
		}
	}, [gitRoot, hasMore, isLoading, isLoadingMore, skip]);

	useEffect(() => {
		if (!showGitLinePicker) {
			return;
		}

		setSearchQuery('');
		setGitLineSelectedIndex(0);
		setSelectedCommits(new Set());
		void loadFirstPage();
	}, [showGitLinePicker, loadFirstPage]);

	useEffect(() => {
		if (!showGitLinePicker || isLoading || isLoadingMore || !hasMore) {
			return;
		}

		if (filteredCommits.length === 0) {
			return;
		}

		if (gitLineSelectedIndex < filteredCommits.length - 4) {
			return;
		}

		void loadMoreGitLineCommits();
	}, [
		filteredCommits.length,
		gitLineSelectedIndex,
		hasMore,
		isLoading,
		isLoadingMore,
		loadMoreGitLineCommits,
		showGitLinePicker,
	]);

	const closeGitLinePicker = useCallback(() => {
		setShowGitLinePicker(false);
		setGitLineSelectedIndex(0);
		setSelectedCommits(new Set());
		setSearchQuery('');
		setError(null);
		setHasMore(true);
		setSkip(0);
		setIsLoadingMore(false);
		triggerUpdate();
	}, [triggerUpdate]);

	const toggleCommitSelection = useCallback(() => {
		const current = filteredCommits[gitLineSelectedIndex];
		if (!current) {
			return;
		}

		setSelectedCommits(prev => {
			const next = new Set(prev);
			if (next.has(current.sha)) {
				next.delete(current.sha);
			} else {
				next.add(current.sha);
			}
			return next;
		});
		triggerUpdate();
	}, [filteredCommits, gitLineSelectedIndex, triggerUpdate]);

	const confirmGitLineSelection = useCallback(() => {
		if (!gitRoot) {
			closeGitLinePicker();
			return;
		}

		let effectiveSelection = selectedCommits;
		if (effectiveSelection.size === 0 && filteredCommits.length > 0) {
			const highlighted = filteredCommits[gitLineSelectedIndex];
			if (highlighted) {
				effectiveSelection = new Set([highlighted.sha]);
			}
		}

		const commitsToInsert = commits.filter(commit =>
			effectiveSelection.has(commit.sha),
		);
		if (commitsToInsert.length === 0) {
			closeGitLinePicker();
			return;
		}

		buffer.setText('');
		for (const commit of commitsToInsert) {
			buffer.insertTextPlaceholder(
				buildInjectedGitLineText(commit, gitRoot),
				`[GitLine:${commit.sha.slice(0, 8)}] `,
			);
		}

		setShowGitLinePicker(false);
		setGitLineSelectedIndex(0);
		setSelectedCommits(new Set());
		setSearchQuery('');
		setError(null);
		setHasMore(true);
		setSkip(0);
		setIsLoadingMore(false);
		triggerUpdate();
	}, [
		buffer,
		closeGitLinePicker,
		commits,
		filteredCommits,
		gitLineSelectedIndex,
		gitRoot,
		selectedCommits,
		triggerUpdate,
	]);

	return {
		showGitLinePicker,
		setShowGitLinePicker,
		gitLineSelectedIndex,
		setGitLineSelectedIndex,
		gitLineCommits: filteredCommits,
		selectedGitLineCommits: selectedCommits,
		gitLineHasMore: hasMore,
		gitLineIsLoading: isLoading,
		gitLineIsLoadingMore: isLoadingMore,
		gitLineSearchQuery: searchQuery,
		setGitLineSearchQuery: setSearchQuery,
		gitLineError: error,
		toggleGitLineCommitSelection: toggleCommitSelection,
		confirmGitLineSelection,
		closeGitLinePicker,
		loadMoreGitLineCommits,
	};
}
