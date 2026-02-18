import * as vscode from 'vscode';
import {WebSocketServer, WebSocket} from 'ws';
import {
	handleGoToDefinition,
	handleFindReferences,
	handleGetSymbols,
	handleGetDiagnostics,
} from './aceHandlers';
import {showGitDiff} from './diffHandlers';

/**
 * WebSocket Server Module
 * Handles WebSocket communication between VSCode extension and Snow CLI
 */

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

/**
 * Normalize file path for consistent comparison
 */
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

/**
 * Get all workspace folder keys for port mapping
 */
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

/**
 * Get workspace folder for a given editor
 */
function getWorkspaceFolderForEditor(
	editor: vscode.TextEditor,
): string | undefined {
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	return (
		normalizePath(folder?.uri.fsPath) ??
		normalizePath(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath)
	);
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(message: string): void {
	for (const client of clients) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(message);
		}
	}
}

/**
 * Send current editor context to all connected clients
 */
export function sendEditorContext(): void {
	if (clients.size === 0) {
		return;
	}

	const editor = vscode.window.activeTextEditor;

	if (!editor) {
		if (vscode.window.visibleTextEditors.length === 0) {
			// All editors closed — clear cached context and notify clients
			lastValidContext = {
				type: 'context',
				workspaceFolder: normalizePath(
					vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				),
				activeFile: undefined,
				cursorPosition: undefined,
				selectedText: undefined,
			};
			broadcast(JSON.stringify(lastValidContext));
		} else if (lastValidContext.activeFile) {
			// Focus moved to non-editor area but files are still open — use cached context
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

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(message: string): void {
	try {
		const data = JSON.parse(message);

		if (data.type === 'getDiagnostics') {
			const filePath = data.filePath;
			const requestId = data.requestId;
			handleGetDiagnostics(filePath, requestId, broadcast);
		} else if (data.type === 'aceGoToDefinition') {
			// ACE Code Search: Go to definition
			const filePath = data.filePath;
			const line = data.line;
			const column = data.column;
			const requestId = data.requestId;
			handleGoToDefinition(filePath, line, column, requestId, broadcast);
		} else if (data.type === 'aceFindReferences') {
			// ACE Code Search: Find references
			const filePath = data.filePath;
			const line = data.line;
			const column = data.column;
			const requestId = data.requestId;
			handleFindReferences(filePath, line, column, requestId, broadcast);
		} else if (data.type === 'aceGetSymbols') {
			// ACE Code Search: Get document symbols
			const filePath = data.filePath;
			const requestId = data.requestId;
			handleGetSymbols(filePath, requestId, broadcast);
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
		} else if (data.type === 'showDiffReview') {
			// Show multiple file diffs for diff review
			const files = data.files;
			if (Array.isArray(files)) {
				vscode.commands.executeCommand('snow-cli.showDiffReview', {files});
			}
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

/**
 * Start the WebSocket server
 */
export function startWebSocketServer(): void {
	if (wss) {
		return; // Server already running
	}

	// Try ports from BASE_PORT to MAX_PORT
	let port = BASE_PORT;

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

/**
 * Stop the WebSocket server
 */
export function stopWebSocketServer(): void {
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

/**
 * Get the actual port the server is running on
 */
export function getActualPort(): number {
	return actualPort;
}

/**
 * Get the number of connected clients
 */
export function getClientCount(): number {
	return clients.size;
}
