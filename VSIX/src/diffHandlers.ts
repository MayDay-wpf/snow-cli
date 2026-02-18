import * as vscode from 'vscode';

/**
 * Diff Handlers
 * Provides showDiff, closeDiff, and showGitDiff functionality
 */

// Track active diff editors
let activeDiffEditors: vscode.Uri[] = [];

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
		}) => {
			try {
				const {filePath, originalContent, newContent, label} = data;

				// Remember the active terminal before showing diff
				const activeTerminal = vscode.window.activeTerminal;

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

				// Register content providers with URI-specific content
				// Store content in a map to support multiple diffs
				const contentMap = new Map<string, string>();
				contentMap.set(originalUri.toString(), originalContent);
				contentMap.set(newUri.toString(), newContent);

				const originalProvider =
					vscode.workspace.registerTextDocumentContentProvider(
						'snow-cli-original',
						{
							provideTextDocumentContent: uri => {
								return contentMap.get(uri.toString()) || '';
							},
						},
					);

				const newProvider =
					vscode.workspace.registerTextDocumentContentProvider('snow-cli-new', {
						provideTextDocumentContent: uri => {
							return contentMap.get(uri.toString()) || '';
						},
					});

				// Show diff view without stealing focus from the terminal
				const fileName = filePath.split('/').pop() || 'file';
				const title = `${label}: ${fileName}`;
				await vscode.commands.executeCommand(
					'vscode.diff',
					originalUri,
					newUri,
					title,
					{
						preview: false,
						preserveFocus: true,
					},
				);

				// Cleanup providers after a delay
				setTimeout(() => {
					originalProvider.dispose();
					newProvider.dispose();
					contentMap.clear();
				}, 2000);
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
					vscode.window.showInformationMessage(
						'No file changes to review',
					);
					return;
				}

				for (const file of files) {
					await vscode.commands.executeCommand('snow-cli.showDiff', {
						filePath: file.filePath,
						originalContent: file.originalContent,
						newContent: file.newContent,
						label: 'Diff Review',
					});
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

			// Clear the tracking array
			activeDiffEditors = [];
		},
	);

	disposables.push(showDiffDisposable, showDiffReviewDisposable, closeDiffDisposable);

	return disposables;
}
