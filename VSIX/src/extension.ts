import * as vscode from 'vscode';
import {
	startWebSocketServer,
	stopWebSocketServer,
	sendEditorContext,
} from './webSocketServer';
import {registerDiffCommands} from './diffHandlers';
import {SidebarTerminalProvider} from './sidebarTerminalProvider';

/**
 * Snow CLI Extension
 * Main entry point for the VSCode extension
 */

let sidebarProvider: SidebarTerminalProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	console.log('Snow CLI extension activating...');

	// 1. 启动 WebSocket 服务器
	startWebSocketServer();

	// 2. 注册 Diff 命令
	const diffDisposables = registerDiffCommands(context);
	context.subscriptions.push(...diffDisposables);

	// 3. 注册 Sidebar Terminal Provider
	sidebarProvider = new SidebarTerminalProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SidebarTerminalProvider.viewType,
			sidebarProvider,
			{webviewOptions: {retainContextWhenHidden: true}},
		),
	);

	// 4. 注册命令
	context.subscriptions.push(
		vscode.commands.registerCommand('snow-cli.openTerminal', () => {
			vscode.commands.executeCommand('snowCliTerminal.focus');
		}),
		vscode.commands.registerCommand('snow-cli.focusSidebar', () => {
			vscode.commands.executeCommand('snowCliTerminal.focus');
		}),
	);

	// 5. 监听编辑器变化
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			sendEditorContext();
		}),
		vscode.window.onDidChangeTextEditorSelection(() => {
			sendEditorContext();
		}),
	);

	console.log('Snow CLI extension activated');
}

export function deactivate() {
	console.log('Snow CLI extension deactivating...');
	sidebarProvider?.dispose();
	stopWebSocketServer();
	console.log('Snow CLI extension deactivated');
}
