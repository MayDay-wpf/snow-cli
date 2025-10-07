import * as vscode from 'vscode';
import WebSocket from 'ws';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

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

	try {
		ws = new WebSocket('ws://localhost:9527');

		ws.on('open', () => {
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
			reconnectTimer = setTimeout(connectToSnowCLI, 3000);
		});

		ws.on('error', () => {});
	} catch (error) {}
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
		}
	} catch (error) {
		// Ignore invalid messages
	}
}

export function activate(context: vscode.ExtensionContext) {
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
