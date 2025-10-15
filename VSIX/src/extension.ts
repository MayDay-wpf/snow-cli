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
			console.error(`Failed to start WebSocket server: all ports ${BASE_PORT}-${MAX_PORT} are in use`);
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
				const workspaceFolder = normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) || '';
				const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');

				try {
					let portInfo: any = {};
					if (fs.existsSync(portInfoPath)) {
						portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
					}
					portInfo[workspaceFolder] = actualPort;
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
		workspaceFolder: normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
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

export function activate(context: vscode.ExtensionContext) {
	// Start WebSocket server immediately when extension activates
	startWebSocketServer();

	const disposable = vscode.commands.registerCommand(
		'snow-cli.openTerminal',
		() => {
			// Create a new terminal split to the right in editor area
			const terminal = vscode.window.createTerminal({
				name: 'Snow CLI',
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

	context.subscriptions.push(disposable);
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
		const workspaceFolder = normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath) || '';
		const portInfoPath = path.join(os.tmpdir(), 'snow-cli-ports.json');

		if (fs.existsSync(portInfoPath)) {
			const portInfo = JSON.parse(fs.readFileSync(portInfoPath, 'utf8'));
			delete portInfo[workspaceFolder];
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
