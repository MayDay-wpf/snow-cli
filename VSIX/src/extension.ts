import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 2000; // 2 seconds

// Global cache for last valid editor context
let lastValidContext: any = {
	type: 'context',
	workspaceFolder: undefined,
	activeFile: undefined,
	cursorPosition: undefined,
	selectedText: undefined
};

function connectToSnowCLI() {
	if (ws?.readyState === WebSocket.OPEN) {
		return;
	}

	// Stop reconnecting if we've exceeded the maximum attempts
	if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		return;
	}

	try {
		ws = new WebSocket('ws://localhost:9527');

		ws.on('open', () => {
			// Reset reconnect attempts on successful connection
			reconnectAttempts = 0;
			sendEditorContext();
		});

		ws.on('message', (message) => {
			handleMessage(message.toString());
		});

		ws.on('close', () => {
			ws = null;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}

			// Exponential backoff with jitter for reconnection
			reconnectAttempts++;
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				const delay = Math.min(
					BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1),
					30000 // Max 30 seconds
				);
				reconnectTimer = setTimeout(connectToSnowCLI, delay);
			}
		});

		ws.on('error', () => {
			// Silently handle errors, let the close event handle reconnection
		});
	} catch (error) {
		// Silently handle connection errors
	}
}

function sendEditorContext() {
	if (!ws || ws.readyState !== WebSocket.OPEN) {
		return;
	}

	const editor = vscode.window.activeTextEditor;

	// If no active editor (focus lost), use cached context
	if (!editor) {
		if (lastValidContext.activeFile) {
			ws.send(JSON.stringify(lastValidContext));
		}
		return;
	}

	const context: any = {
		type: 'context',
		workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		activeFile: editor.document.uri.fsPath,
		cursorPosition: {
			line: editor.selection.active.line,
			character: editor.selection.active.character
		}
	};

	// Capture selection
	if (!editor.selection.isEmpty) {
		context.selectedText = editor.document.getText(editor.selection);
	}

	// Always update cache with valid editor state
	lastValidContext = { ...context };

	ws.send(JSON.stringify(context));
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
				code: d.code
			}));

			// Send response back
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({
					type: 'diagnostics',
					requestId,
					diagnostics: simpleDiagnostics
				}));
			}
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
		} else if (data.type === 'diffApply') {
			const filePath = data.filePath;
			const oldContent = data.oldContent;
			const newContent = data.newContent;
			const requestId = data.requestId;

			// Show diff in VS Code
			handleDiffApply(filePath, oldContent, newContent, requestId);
		}
	} catch (error) {
		// Ignore invalid messages
	}
}

async function handleGoToDefinition(filePath: string, line: number, column: number, requestId: string) {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in go to definition
		const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeDefinitionProvider',
			uri,
			position
		);

		const results = (definitions || []).map(def => ({
			filePath: def.uri.fsPath,
			line: def.range.start.line,
			column: def.range.start.character,
			endLine: def.range.end.line,
			endColumn: def.range.end.character
		}));

		// Send response back
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: results
			}));
		}
	} catch (error) {
		// On error, send empty results
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceGoToDefinitionResult',
				requestId,
				definitions: []
			}));
		}
	}
}

async function handleFindReferences(filePath: string, line: number, column: number, requestId: string) {
	try {
		const uri = vscode.Uri.file(filePath);
		const position = new vscode.Position(line, column);

		// Use VS Code's built-in find references
		const references = await vscode.commands.executeCommand<vscode.Location[]>(
			'vscode.executeReferenceProvider',
			uri,
			position
		);

		const results = (references || []).map(ref => ({
			filePath: ref.uri.fsPath,
			line: ref.range.start.line,
			column: ref.range.start.character,
			endLine: ref.range.end.line,
			endColumn: ref.range.end.character
		}));

		// Send response back
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: results
			}));
		}
	} catch (error) {
		// On error, send empty results
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceFindReferencesResult',
				requestId,
				references: []
			}));
		}
	}
}

async function handleGetSymbols(filePath: string, requestId: string) {
	try {
		const uri = vscode.Uri.file(filePath);

		// Use VS Code's built-in document symbol provider
		const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
			'vscode.executeDocumentSymbolProvider',
			uri
		);

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
					detail: symbol.detail
				});
				if (symbol.children && symbol.children.length > 0) {
					result.push(...flattenSymbols(symbol.children));
				}
			}
			return result;
		};

		const results = symbols ? flattenSymbols(symbols) : [];

		// Send response back
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: results
			}));
		}
	} catch (error) {
		// On error, send empty results
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'aceGetSymbolsResult',
				requestId,
				symbols: []
			}));
		}
	}
}

async function handleDiffApply(filePath: string, oldContent: string, newContent: string, requestId: string) {
	try {
		// Create a temporary file for old content
		const oldUri = vscode.Uri.parse(`untitled:${filePath}.old`);
		const newUri = vscode.Uri.file(filePath);

		// Show diff editor
		await vscode.commands.executeCommand(
			'vscode.diff',
			oldUri,
			newUri,
			`${filePath} (Confirm Changes)`
		);

		// Write old content to the left side
		const edit = new vscode.WorkspaceEdit();
		edit.createFile(oldUri, { overwrite: true });
		edit.insert(oldUri, new vscode.Position(0, 0), oldContent);
		await vscode.workspace.applyEdit(edit);

		// Show quick pick for user decision
		const choice = await vscode.window.showQuickPick(
			[
				{ label: 'Approve (once)', value: 'approve' },
				{ label: 'Always approve this tool', value: 'approve_always' },
				{ label: 'Reject (end session)', value: 'reject' }
			],
			{
				placeHolder: 'Review the changes and choose an action',
				ignoreFocusOut: true
			}
		);

		const result = choice?.value || 'approve';

		// Send response back
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'diffApplyResult',
				requestId,
				result
			}));
		}

		// Close the diff editor
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	} catch (error) {
		// On error, default to approve and let CLI handle confirmation
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({
				type: 'diffApplyResult',
				requestId,
				result: 'approve'
			}));
		}
	}
}

export function activate(context: vscode.ExtensionContext) {
	// Try to connect immediately when extension activates
	connectToSnowCLI();

	const disposable = vscode.commands.registerCommand('snow-cli.openTerminal', () => {
		// Create a new terminal split to the right in editor area
		const terminal = vscode.window.createTerminal({
			name: 'Snow CLI',
			location: {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: false
			}
		});

		// Show the terminal
		terminal.show();

		// Execute the snow command
		terminal.sendText('snow');

		// Reset reconnect attempts when manually opening terminal
		reconnectAttempts = 0;
		// Try to connect to Snow CLI WebSocket server
		setTimeout(connectToSnowCLI, 2000);
	});

	// Listen to editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			sendEditorContext();
		})
	);

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(() => {
			sendEditorContext();
		})
	);

	context.subscriptions.push(disposable);
}

export function deactivate() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
	}
	if (ws) {
		ws.close();
		ws = null;
	}
}
