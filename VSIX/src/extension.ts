import * as vscode from 'vscode';
import {WebSocketServer, WebSocket} from 'ws';

let wss: WebSocketServer | null = null;
let clients: Set<WebSocket> = new Set();
let actualPort = 9527;
const BASE_PORT = 9527;
const MAX_PORT = 9537;

// Global cache for last valid editor context
let lastValidContext: any = {
	type: 'context',
	workspaceFolder: undefined,
	activeFile: undefined,
	cursorPosition: undefined,
	selectedText: undefined,
};

function startWebSocketServer() {
	if (wss) {
		return; // Server already running
	}

	// Try ports from BASE_PORT to MAX_PORT
	let port = BASE_PORT;
	let serverStarted = false;

	const tryPort = (currentPort: number) => {
		if (currentPort > MAX_PORT) {
			console.error(
				`Failed to start WebSocket server: all ports ${BASE_PORT}-${MAX_PORT} are in use`,
			);
			return;
		}

		try {
			const server = new WebSocketServer({port: currentPort});

			server.on('error', (error: any) => {
				if (error.code === 'EADDRINUSE') {
					console.log(`Port ${currentPort} is in use, trying next port...`);
					tryPort(currentPort + 1);
				} else {
					console.error('WebSocket server error:', error);
				}
			});

			server.on('listening', () => {
				actualPort = currentPort;
				serverStarted = true;
				console.log(`Snow CLI WebSocket server started on port ${actualPort}`);

				// Write port to a temp file so CLI can discover it
				const fs = require('fs');
				const os = require('os');
				const path = require('path');
				const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');

				try {
					let portInfo: any = {};
					if (fs.existsSync(portInfoPath)) {
						portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
					}

					// Map *every* workspace folder in this VSCode window to the same port.
					// This keeps multi-root workspaces working regardless of which folder the terminal is bound to.
					for (const workspaceFolder of getWorkspaceFolderKeys()) {
						portInfo[workspaceFolder] = actualPort;
					}

					fs.writeFileSync(portInfoPath, JSON.stringify(portInfo, null, 2));
				} catch (err) {
					console.error('Failed to write port info:', err);
				}
			});

			server.on('connection', ws => {
				console.log('Snow CLI connected');
				clients.add(ws);

				// Send current editor context immediately upon connection
				sendEditorContext();

				ws.on('message', message => {
					handleMessage(message.toString());
				});

				ws.on('close', () => {
					console.log('Snow CLI disconnected');
					clients.delete(ws);
				});

				ws.on('error', error => {
					console.error('WebSocket error:', error);
					clients.delete(ws);
				});
			});

			wss = server;
		} catch (error) {
			console.error(`Failed to start server on port ${currentPort}:`, error);
			tryPort(currentPort + 1);
		}
	};

	tryPort(port);
}

function normalizePath(filePath: string | undefined): string | undefined {
	if (!filePath) {
		return undefined;
	}
	// Convert Windows backslashes to forward slashes for consistent path comparison
	let normalized = filePath.replace(/\\/g, '/');
	// Convert Windows drive letter to lowercase (C: -> c:)
	if (/^[A-Z]:/.test(normalized)) {
		normalized = normalized.charAt(0).toLowerCase() + normalized.slice(1);
	}
	return normalized;
}

function getWorkspaceFolderKeys(): string[] {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const keys = folders
		.map(folder => normalizePath(folder.uri.fsPath))
		.filter((p): p is string => Boolean(p));

	// Preserve existing behavior for "single file" mode (no workspace folders).
	if (keys.length === 0) {
		return [''];
	}

	// De-dupe in case VSCode reports duplicates.
	return Array.from(new Set(keys));
}

function getWorkspaceFolderForEditor(
	editor: vscode.TextEditor,
): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	return (
		normalizePath(folder?.uri.fsPath) ??
		normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)
	);
}

function sendEditorContext() {
	if (clients.size === 0) {
		return;
	}

	const editor = vscode.window.activeTextEditor;

	// If no active editor (focus lost), use cached context
	if (!editor) {
		if (lastValidContext.activeFile) {
			broadcast(JSON.stringify(lastValidContext));
		}
		return;
	}

	const context: any = {
		type: 'context',
		// In multi-root workspaces, tie context to the workspace folder owning the active file.
		workspaceFolder: getWorkspaceFolderForEditor(editor),
		activeFile: normalizePath(editor.document.uri.fsPath),
		cursorPosition: {
			line: editor.selection.active.line,
			character: editor.selection.active.character,
		},
	};

	// Capture selection
	if (!editor.selection.isEmpty) {
		context.selectedText = editor.document.getText(editor.selection);
	}

	// Always update cache with valid editor state
	lastValidContext = {...context};

	broadcast(JSON.stringify(context));
}

function broadcast(message: string) {
	for (const client of clients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

function handleMessage(message: string) {
	try {
		const data = JSON.parse(message);

		if (data.type === 'getDiagnostics') {
			const filePath = data.filePath;
			const requestId = data.requestId;

			// Get diagnostics for the file
			const uri = vscode.Uri.file(filePath);
			const diagnostics = vscode.languages.getDiagnostics(uri);

			// Convert to simpler format
			const simpleDiagnostics = diagnostics.map(d => ({
				message: d.message,
				severity: ['error', 'warning', 'info', 'hint'][d.severity],
				line: d.range.start.line,
				character: d.range.start.character,
				source: d.source,
				code: d.code,
			}));

			// Send response back to all connected clients
			broadcast(
				JSON.stringify({
					type: 'diagnostics',
					requestId,
					diagnostics: simpleDiagnostics,
				}),
			);
		} else if (data.type === 'aceGoToDefinition') {
			// ACE Code Search: Go to definition
			const filePath = data.filePath;
			const line = data.line;
			const column = data.column;
			const requestId = data.requestId;

			handleGoToDefinition(filePath, line, column, requestId);
		} else if (data.type === 'aceFindReferences') {
			// ACE Code Search: Find references
			const filePath = data.filePath;
			const line = data.line;
			const column = data.column;
			const requestId = data.requestId;

			handleFindReferences(filePath, line, column, requestId);
		} else if (data.type === 'aceGetSymbols') {
			// ACE Code Search: Get document symbols
			const filePath = data.filePath;
			const requestId = data.requestId;

			handleGetSymbols(filePath, requestId);
		} else if (data.type === 'showDiff') {
			// Show diff in VSCode
			const filePath = data.filePath;
			const originalContent = data.originalContent;
			const newContent = data.newContent;
			const label = data.label;

			// Execute the showDiff command
			vscode.commands.executeCommand('snow-cli.showDiff', {
				filePath,
				originalContent,
				newContent,
				label,
			});
		} else if (data.type === 'closeDiff') {
			// Close diff view by calling the closeDiff command
			vscode.commands.executeCommand('snow-cli.closeDiff');
		} else if (data.type === 'showGitDiff') {
			// Show git diff for a file in VSCode
			const filePath = data.filePath;
			if (filePath) {
				showGitDiff(filePath);
			}
		}
	} catch (error) {
		// Ignore invalid messages
	}
}

async function handleGoToDefinition(
	filePath: string,
	line: number,
	column: number,
	requestId: string,
) {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in go to definition
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position,
		);

		const results = (definitions || []).map(def => ({
			filePath: def.uri.fsPath,
			line: def.range.start.line,
			column: def.range.start.character,
			endLine: def.range.end.line,
			endColumn: def.range.end.character,
		}));

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: [],
			}),
		);
	}
}

async function handleFindReferences(
	filePath: string,
	line: number,
	column: number,
	requestId: string,
) {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in find references
		const references = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider',
			uri,
			position,
		);

		const results = (references || []).map(ref => ({
			filePath: ref.uri.fsPath,
			line: ref.range.start.line,
			column: ref.range.start.character,
			endLine: ref.range.end.line,
			endColumn: ref.range.end.character,
		}));

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: [],
			}),
		);
	}
}

async function handleGetSymbols(filePath: string, requestId: string) {
	try {
		const uri = vscode.Uri.file(filePath);

		// Use VS Code's built-in document symbol provider
		const symbols = await vscode.commands.executeCommand<
			vscode.DocumentSymbol[]
		>('vscode.executeDocumentSymbolProvider', uri);

		const flattenSymbols = (symbolList: vscode.DocumentSymbol[]): any[] => {
			const result: any[] = [];
			for (const symbol of symbolList) {
				result.push({
					name: symbol.name,
					kind: vscode.SymbolKind[symbol.kind],
					line: symbol.range.start.line,
					column: symbol.range.start.character,
					endLine: symbol.range.end.line,
					endColumn: symbol.range.end.character,
					detail: symbol.detail,
				});
				if (symbol.children && symbol.children.length > 0) {
					result.push(...flattenSymbols(symbol.children));
				}
			}
			return result;
		};

		const results = symbols ? flattenSymbols(symbols) : [];

		// Send response back
		broadcast(
			JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: results,
			}),
		);
	} catch (error) {
		// On error, send empty results
		broadcast(
			JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: [],
			}),
		);
	}
}

/**
 * Show git diff for a file in VSCode
 * Opens the file's git changes in a diff view
 */
async function showGitDiff(filePath: string) {
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

// Track active diff editors
let activeDiffEditors: vscode.Uri[] = [];

export function activate(context: vscode.ExtensionContext) {
	// Start WebSocket server immediately when extension activates
	startWebSocketServer();

	const disposable = vscode.commands.registerCommand(
		'snow-cli.openTerminal',
		() => {
			const editor = vscode.window.activeTextEditor;
			const cwd =
				editor &&
				vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;

			// Create a new terminal split to the right in editor area
			const terminal = vscode.window.createTerminal({
				name: 'Snow CLI',
				// Ensure the CLI starts in the workspace folder of the active file (important for multi-root workspaces).
				cwd: cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				location: {
					viewColumn: vscode.ViewColumn.Beside,
					preserveFocus: false,
				},
			});

			// Show the terminal
			terminal.show();

			// Execute the snow command
			terminal.sendText('snow');
		},
	);

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

				// Show diff view with preview:false to prevent tabs from being replaced
				const fileName = filePath.split('/').pop() || 'file';
				const title = `${label}: ${fileName}`;
				await vscode.commands.executeCommand(
					'vscode.diff',
					originalUri,
					newUri,
					title,
					{
						preview: false, // Changed to false to keep multiple tabs open
					},
				);

				// Force focus back to terminal after diff is shown
				// Multiple attempts to ensure focus is restored
				setTimeout(() => {
					if (activeTerminal) {
						activeTerminal.show(false); // false = preserveFocus, focuses the terminal
					}
				}, 50);

				setTimeout(() => {
					if (activeTerminal) {
						activeTerminal.show(false);
					}
				}, 150);

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

	// Listen to editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			sendEditorContext();
		}),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(() => {
			sendEditorContext();
		}),
	);

	context.subscriptions.push(
		disposable,
		showDiffDisposable,
		closeDiffDisposable,
	);
}

export function deactivate() {
	// Close all client connections
	for (const client of clients) {
		client.close();
	}
	clients.clear();

	// Close server
	if (wss) {
		wss.close();
		wss = null;
	}

	// Clean up port info file
	try {
		const fs = require('fs');
		const os = require('os');
		const path = require('path');
		const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');

		if (fs.existsSync(portInfoPath)) {
			const portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
			for (const workspaceFolder of getWorkspaceFolderKeys()) {
				delete portInfo[workspaceFolder];
			}
			if (Object.keys(portInfo).length === 0) {
				fs.unlinkSync(portInfoPath);
			} else {
				fs.writeFileSync(portInfoPath, JSON.stringify(portInfo, null, 2));
			}
		}
	} catch (err) {
		console.error('Failed to clean up port info:', err);
	}
}
