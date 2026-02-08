import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {execSync} from 'node:child_process';

interface BranchInfo {
	name: string;
	isCurrent: boolean;
}

interface Props {
	onClose: () => void;
}

/**
 * Extract meaningful error message from execSync failure.
 * Node's execSync puts the real git output in error.stderr.
 */
function getGitError(error: unknown): string {
	if (error && typeof error === 'object') {
		const err = error as Record<string, unknown>;
		// execSync attaches stderr as a string (when encoding is set)
		const stderr = err['stderr'];
		if (typeof stderr === 'string' && stderr.trim()) {
			return stderr.trim();
		}
	}

	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

/**
 * Check if current directory is inside a git repository.
 */
function isGitRepo(): boolean {
	try {
		execSync('git rev-parse --is-inside-work-tree', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * List all local git branches, marking the current one.
 */
function listBranches(): BranchInfo[] {
	try {
		const output = execSync('git branch --list', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return output
			.split('\n')
			.filter(line => line.trim().length > 0)
			.map(line => {
				const isCurrent = line.startsWith('* ');
				const name = line.replace(/^\*?\s+/, '').trim();
				return {name, isCurrent};
			});
	} catch {
		return [];
	}
}

type CheckoutResult = {
	success: boolean;
	message: string;
	conflict?: boolean; // true when local changes block checkout
};

/**
 * Switch to an existing branch.
 */
function checkoutBranch(branchName: string): CheckoutResult {
	try {
		execSync(`git checkout ${branchName}`, {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return {success: true, message: `Switched to branch: ${branchName}`};
	} catch (error) {
		const msg = getGitError(error);
		// Detect "local changes would be overwritten" conflict
		const isConflict =
			msg.includes('would be overwritten') ||
			msg.includes('Please commit your changes or stash them') ||
			msg.includes('error: Your local changes');
		return {success: false, message: msg, conflict: isConflict};
	}
}

/**
 * Stash current changes, checkout branch, then optionally pop stash.
 */
function stashAndCheckout(
	branchName: string,
): {success: boolean; message: string} {
	try {
		execSync('git stash push -m "auto-stash before branch switch"', {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
	} catch (error) {
		const msg = getGitError(error);
		return {success: false, message: `Stash failed: ${msg}`};
	}

	try {
		execSync(`git checkout ${branchName}`, {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return {
			success: true,
			message: `Stashed changes and switched to: ${branchName}\n(Use "git stash pop" to restore your changes)`,
		};
	} catch (error) {
		// Checkout still failed, pop stash to restore original state
		try {
			execSync('git stash pop', {stdio: 'pipe', encoding: 'utf-8'});
		} catch {
			// Ignore pop failure
		}

		const msg = getGitError(error);
		return {
			success: false,
			message: `Stash succeeded but checkout failed: ${msg}`,
		};
	}
}

/**
 * Create and checkout a new branch.
 */
function createBranch(
	branchName: string,
): {success: boolean; message: string} {
	try {
		execSync(`git checkout -b ${branchName}`, {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return {
			success: true,
			message: `Created and switched to: ${branchName}`,
		};
	} catch (error) {
		return {success: false, message: getGitError(error)};
	}
}

/**
 * Delete a local branch.
 */
function deleteBranch(
	branchName: string,
): {success: boolean; message: string} {
	try {
		execSync(`git branch -d ${branchName}`, {
			stdio: 'pipe',
			encoding: 'utf-8',
		});
		return {success: true, message: `Deleted branch: ${branchName}`};
	} catch (error) {
		const msg = getGitError(error);
		if (msg.includes('not fully merged')) {
			try {
				execSync(`git branch -D ${branchName}`, {
					stdio: 'pipe',
					encoding: 'utf-8',
				});
				return {
					success: true,
					message: `Force deleted branch: ${branchName}`,
				};
			} catch (error2) {
				return {
					success: false,
					message: getGitError(error2),
				};
			}
		}

		return {success: false, message: msg};
	}
}

type PanelMode = 'list' | 'create' | 'confirmDelete' | 'confirmStash';

export const BranchPanel: React.FC<Props> = ({onClose}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [mode, setMode] = useState<PanelMode>('list');
	const [branches, setBranches] = useState<BranchInfo[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isGit, setIsGit] = useState(true);
	const [message, setMessage] = useState<{
		type: 'success' | 'error' | 'warning';
		text: string;
	} | null>(null);
	const [newBranchName, setNewBranchName] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [pendingStashBranch, setPendingStashBranch] = useState<string | null>(
		null,
	);

	const bp = t.branchPanel;

	// Load branches
	const loadBranches = useCallback(() => {
		if (!isGitRepo()) {
			setIsGit(false);
			return;
		}

		setIsGit(true);
		const branchList = listBranches();
		setBranches(branchList);

		// Ensure selected index is within bounds
		if (selectedIndex >= branchList.length) {
			setSelectedIndex(Math.max(0, branchList.length - 1));
		}
	}, [selectedIndex]);

	useEffect(() => {
		loadBranches();
	}, []);

	// Handle branch switch
	const handleSwitch = useCallback(() => {
		const branch = branches[selectedIndex];
		if (!branch || branch.isCurrent) return;

		setIsLoading(true);
		setMessage(null);

		const result = checkoutBranch(branch.name);
		setIsLoading(false);

		if (result.success) {
			setMessage({type: 'success', text: result.message});
			loadBranches();
		} else if (result.conflict) {
			// Local changes block checkout - ask user if they want to stash
			setPendingStashBranch(branch.name);
			setMode('confirmStash');
			setMessage(null);
		} else {
			setMessage({type: 'error', text: result.message});
		}
	}, [branches, selectedIndex, loadBranches]);

	// Handle stash-and-checkout confirmation
	const handleStashAndSwitch = useCallback(() => {
		if (!pendingStashBranch) return;

		setIsLoading(true);
		setMessage(null);

		const result = stashAndCheckout(pendingStashBranch);
		setIsLoading(false);

		setMessage({
			type: result.success ? 'success' : 'error',
			text: result.message,
		});

		setPendingStashBranch(null);
		setMode('list');

		if (result.success) {
			loadBranches();
		}
	}, [pendingStashBranch, loadBranches]);

	// Handle branch creation
	const handleCreate = useCallback(() => {
		const trimmedName = newBranchName.trim();
		if (!trimmedName) return;

		setIsLoading(true);
		setMessage(null);

		const result = createBranch(trimmedName);
		setIsLoading(false);

		setMessage({
			type: result.success ? 'success' : 'error',
			text: result.message,
		});

		if (result.success) {
			setNewBranchName('');
			setMode('list');
			loadBranches();
		}
	}, [newBranchName, loadBranches]);

	// Handle branch deletion
	const handleDelete = useCallback(() => {
		const branch = branches[selectedIndex];
		if (!branch) return;

		setIsLoading(true);
		setMessage(null);

		const result = deleteBranch(branch.name);
		setIsLoading(false);

		setMessage({
			type: result.success ? 'success' : 'error',
			text: result.message,
		});

		setMode('list');

		if (result.success) {
			loadBranches();
		}
	}, [branches, selectedIndex, loadBranches]);

	useInput((input, key) => {
		if (isLoading) return;

		// Create mode input handling
		if (mode === 'create') {
			if (key.escape) {
				setMode('list');
				setNewBranchName('');
				setMessage(null);
				return;
			}

			if (key.return) {
				handleCreate();
				return;
			}

			// TextInput handles the rest
			return;
		}

		// Confirm stash-and-switch mode
		if (mode === 'confirmStash') {
			if (input.toLowerCase() === 'y') {
				handleStashAndSwitch();
				return;
			}

			if (input.toLowerCase() === 'n' || key.escape) {
				setPendingStashBranch(null);
				setMode('list');
				setMessage(null);
				return;
			}

			return;
		}

		// Confirm delete mode
		if (mode === 'confirmDelete') {
			if (input.toLowerCase() === 'y') {
				handleDelete();
				return;
			}

			if (input.toLowerCase() === 'n' || key.escape) {
				setMode('list');
				setMessage(null);
				return;
			}

			return;
		}

		// List mode
		if (key.escape) {
			onClose();
			return;
		}

		// Navigation
		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev =>
				Math.min(branches.length - 1, prev + 1),
			);
			return;
		}

		// Switch branch
		if (key.return) {
			handleSwitch();
			return;
		}

		// Create new branch
		if (input.toLowerCase() === 'n') {
			setMode('create');
			setMessage(null);
			return;
		}

		// Delete branch
		if (input.toLowerCase() === 'd') {
			const branch = branches[selectedIndex];
			if (!branch) return;
			if (branch.isCurrent) {
				setMessage({
					type: 'error',
					text:
						bp.cannotDeleteCurrent ||
						'Cannot delete the currently checked-out branch',
				});
				return;
			}

			setMode('confirmDelete');
			setMessage(null);
			return;
		}
	});

	// Not a git repo
	if (!isGit) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuSelected}>
						{bp.title || 'Git Branch Management'}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.error}>
						{bp.notGitRepo ||
							'Current directory is not a Git repository. Cannot manage branches.'}
					</Text>
				</Box>
				<Text dimColor>
					{bp.pressEscToClose || 'Press ESC to close'}
				</Text>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			{/* Title */}
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{bp.title || 'Git Branch Management'}
				</Text>
			</Box>

			{/* Branch List */}
			<Box flexDirection="column" marginBottom={1}>
				{branches.length === 0 ? (
					<Box>
						<Text dimColor>
							{bp.noBranches ||
								'No branches found. Press N to create one.'}
						</Text>
					</Box>
				) : (
					branches.map((branch, index) => (
						<Box key={branch.name}>
							<Text
								color={
									index === selectedIndex
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={index === selectedIndex}
							>
								{index === selectedIndex ? '❯ ' : '  '}
								{branch.isCurrent ? '● ' : '○ '}
								{branch.name}
								{branch.isCurrent
									? ` (${bp.current || 'current'})`
									: ''}
							</Text>
						</Box>
					))
				)}
			</Box>

			{/* Create mode - text input */}
			{mode === 'create' && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={theme.colors.cyan} bold>
						{bp.newBranchLabel || 'New branch name:'}
					</Text>
					<Box>
						<Text color={theme.colors.cyan}>{'> '}</Text>
						<TextInput
							value={newBranchName}
							onChange={setNewBranchName}
							onSubmit={handleCreate}
							placeholder={
								bp.newBranchPlaceholder || 'feature/my-new-branch'
							}
						/>
					</Box>
					<Text dimColor>
						{bp.createHint ||
							'Enter to confirm, ESC to cancel'}
					</Text>
				</Box>
			)}

			{/* Confirm stash-and-switch */}
			{mode === 'confirmStash' && pendingStashBranch && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={theme.colors.warning}>
						{(
							bp.stashConfirm ||
							'Local changes detected. Stash changes and switch to "{branch}"?'
						).replace('{branch}', pendingStashBranch)}
					</Text>
					<Text dimColor>
						{bp.stashConfirmHint ||
							'Press Y to stash & switch, N to cancel'}
					</Text>
				</Box>
			)}

			{/* Confirm delete */}
			{mode === 'confirmDelete' && branches[selectedIndex] && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={theme.colors.warning}>
						{(
							bp.confirmDelete ||
							'Delete branch "{branch}"?'
						).replace('{branch}', branches[selectedIndex]!.name)}
					</Text>
					<Text dimColor>
						{bp.confirmDeleteHint ||
							'Press Y to confirm, N to cancel'}
					</Text>
				</Box>
			)}

			{/* Message */}
			{message && (
				<Box marginBottom={1}>
					<Text
						color={
							message.type === 'success'
								? theme.colors.success
								: message.type === 'warning'
									? theme.colors.warning
									: theme.colors.error
						}
					>
						{message.text}
					</Text>
				</Box>
			)}

			{/* Loading */}
			{isLoading && (
				<Box marginBottom={1}>
					<Text color={theme.colors.warning}>
						{bp.loading || 'Processing...'}
					</Text>
				</Box>
			)}

			{/* Hints */}
			{mode === 'list' && (
				<Box flexDirection="column">
					<Text dimColor>
						{bp.hints ||
							'↑↓: Navigate | Enter: Switch | N: New branch | D: Delete | ESC: Close'}
					</Text>
				</Box>
			)}
		</Box>
	);
};
