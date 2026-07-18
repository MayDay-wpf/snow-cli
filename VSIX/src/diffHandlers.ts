import * as vscode from 'vscode';

/**
 * Diff Handlers
 * Provides showDiff, closeDiff, and showGitDiff functionality
 */

// Track active diff editors
let activeDiffEditors: vscode.Uri[] = [];

// Shared content map keyed by URI string. Persists across multiple showDiff
// invocations so that VSCode can re-query content for any open diff editor.
const diffContentMap = new Map<string, string>();

// Track whether content providers for our virtual schemes have been registered.
// VSCode only uses the most-recently-registered provider for a given scheme,
// so we MUST register exactly once per scheme and keep them alive while diffs
// are open. Otherwise newly opened diffs replace previous providers and earlier
// diff editors lose access to their content (showing empty diffs).
let originalProviderDisposable: vscode.Disposable | null = null;
let newProviderDisposable: vscode.Disposable | null = null;

function ensureContentProvidersRegistered(): void {
	if (!originalProviderDisposable) {
		originalProviderDisposable =
			vscode.workspace.registerTextDocumentContentProvider(
				'snow-cli-original',
				{
					provideTextDocumentContent: uri => {
						return diffContentMap.get(uri.toString()) ?? '';
					},
				},
			);
	}
	if (!newProviderDisposable) {
		newProviderDisposable =
			vscode.workspace.registerTextDocumentContentProvider('snow-cli-new', {
				provideTextDocumentContent: uri => {
					return diffContentMap.get(uri.toString()) ?? '';
				},
			});
	}
}

function disposeContentProviders(): void {
	if (originalProviderDisposable) {
		originalProviderDisposable.dispose();
		originalProviderDisposable = null;
	}
	if (newProviderDisposable) {
		newProviderDisposable.dispose();
		newProviderDisposable = null;
	}
	diffContentMap.clear();
}

/**
 * Show git diff for a file in VSCode
 * Opens the file's git changes in a diff view
 */
export async function showGitDiff(filePath: string): Promise<void> {
	console.log('[Snow Extension] showGitDiff called for:', filePath);
	try {
		const path = require('path');
		const fs = require('fs');
		const {execFile} = require('child_process');

		// Ensure absolute path
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const absolutePath = path.isAbsolute(filePath)
			? filePath
			: path.join(workspaceRoot || '', filePath);

		const fileUri = vscode.Uri.file(absolutePath);
		const repoRoot =
			vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath ?? workspaceRoot;

		if (!repoRoot) {
			throw new Error('No workspace folder found for git diff');
		}

		// Compute path relative to repo root for git show
		const relPath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');

		const newContent = fs.readFileSync(absolutePath, 'utf8');

		let originalContent = '';
		try {
			originalContent = await new Promise((resolve, reject) => {
				execFile(
					'git',
					['show', `HEAD:${relPath}`],
					{cwd: repoRoot, maxBuffer: 50 * 1024 * 1024},
					(error: any, stdout: string, stderr: string) => {
						if (error) {
							reject(new Error(stderr || String(error)));
							return;
						}
						resolve(stdout);
					},
				);
			});
		} catch (error) {
			// File may be new/untracked or missing in HEAD; fall back to empty original content
			console.log(
				'[Snow Extension] git show failed, using empty base:',
				error instanceof Error ? error.message : String(error),
			);
		}

		await vscode.commands.executeCommand('snow-cli.showDiff', {
			filePath: absolutePath,
			originalContent,
			newContent,
			label: 'Git Diff',
		});
	} catch (error) {
		console.error('[Snow Extension] Failed to show git diff:', error);
		try {
			const uri = vscode.Uri.file(filePath);
			await vscode.window.showTextDocument(uri, {preview: true});
		} catch {
			// Ignore errors
		}
	}
}

/**
 * Register diff-related commands
 * Returns an array of disposables that should be added to context.subscriptions
 */
export function registerDiffCommands(
	_context: vscode.ExtensionContext,
): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	// Register command to show diff in VSCode
	const showDiffDisposable = vscode.commands.registerCommand(
		'snow-cli.showDiff',
		async (data: {
			filePath: string;
			originalContent: string;
			newContent: string;
			label: string;
			// When true, do NOT preserve focus on the previously active editor
			// (terminal). Used by diff-review multi-file flow so each diff
			// becomes a real, pinned tab rather than being replaced by the
			// next vscode.diff call (which can happen if focus stays on the
			// terminal and the active editor group is empty/unstable).
			takeFocus?: boolean;
		}) => {
			try {
				const {filePath, originalContent, newContent, label, takeFocus} = data;

				// Create virtual URIs for diff view with unique identifier
				const uri = vscode.Uri.file(filePath);
				const uniqueId = `${Date.now()}-${Math.random()
					.toString(36)
					.substring(7)}`;
				const originalUri = uri.with({
					scheme: 'snow-cli-original',
					query: uniqueId,
				});
				const newUri = uri.with({
					scheme: 'snow-cli-new',
					query: uniqueId,
				});

				// Track these URIs for later cleanup
				activeDiffEditors.push(originalUri, newUri);

				// Store content in the SHARED content map. Using one persistent
				// map (not a per-call local one) is critical because VSCode may
				// re-query the content provider at any time while the diff
				// editor is open, including after subsequent showDiff calls
				// register new content for other files.
				diffContentMap.set(originalUri.toString(), originalContent);
				diffContentMap.set(newUri.toString(), newContent);

				// Register the content providers exactly once. Re-registering
				// the same scheme would replace the prior provider and break
				// previously opened diff editors.
				ensureContentProvidersRegistered();

				// Show diff view. By default we preserve focus so single-file
				// edit confirmations don't yank focus from the terminal. For
				// the multi-file diff review flow, the caller passes
				// takeFocus=true so each tab is properly created+visible.
				const fileName = filePath.split(/[\\/]/).pop() || 'file';
				const title = `${label}: ${fileName}`;
				await vscode.commands.executeCommand(
					'vscode.diff',
					originalUri,
					newUri,
					title,
					{
						preview: false,
						preserveFocus: !takeFocus,
						viewColumn: vscode.ViewColumn.Active,
					},
				);
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to show diff: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);

	// Register command to show diff review (multiple files)
	const showDiffReviewDisposable = vscode.commands.registerCommand(
		'snow-cli.showDiffReview',
		async (data: {
			files: Array<{
				filePath: string;
				originalContent: string;
				newContent: string;
			}>;
		}) => {
			try {
				const {files} = data;
				if (!files || files.length === 0) {
					vscode.window.showInformationMessage('No file changes to review');
					return;
				}

				for (const file of files) {
					await vscode.commands.executeCommand('snow-cli.showDiff', {
						filePath: file.filePath,
						originalContent: file.originalContent,
						newContent: file.newContent,
						label: 'Diff Review',
						takeFocus: true,
					});
					// Yield a tick so VSCode can fully realize the new diff tab
					// before we open the next one. Without this, a rapid
					// sequence of vscode.diff calls can collapse into a single
					// visible tab (later ones replace earlier ones in the same
					// editor slot).
					await new Promise(resolve => setTimeout(resolve, 80));
				}
			} catch (error) {
				vscode.window.showErrorMessage(
					`Failed to show diff review: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);

	// Register command to close diff views
	const closeDiffDisposable = vscode.commands.registerCommand(
		'snow-cli.closeDiff',
		() => {
			// Close only the diff editors we opened
			const editors = vscode.window.tabGroups.all
				.flatMap(group => group.tabs)
				.filter(tab => {
					if (tab.input instanceof vscode.TabInputTextDiff) {
						const original = tab.input.original;
						const modified = tab.input.modified;
						return (
							activeDiffEditors.some(
								uri => uri.toString() === original.toString(),
							) ||
							activeDiffEditors.some(
								uri => uri.toString() === modified.toString(),
							)
						);
					}
					return false;
				});

			// Close each matching tab
			editors.forEach(tab => {
				vscode.window.tabGroups.close(tab);
			});

			// Clear the tracking array and dispose shared providers/content
			activeDiffEditors = [];
			disposeContentProviders();
		},
	);

	disposables.push(
		showDiffDisposable,
		showDiffReviewDisposable,
		closeDiffDisposable,
	);

	return disposables;
}
