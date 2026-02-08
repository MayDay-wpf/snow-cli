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

/** Read a configuration value with fallback */
function getConfig<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration('snow-cli').get<T>(key, fallback);
}

/** Apply the context key so the sidebar view shows/hides accordingly */
function applySidebarContext(): void {
	const mode = getConfig<string>('terminalMode', 'split');
	vscode.commands.executeCommand(
		'setContext',
		'snow-cli.sidebarMode',
		mode === 'sidebar',
	);
}

/** Create a new split terminal in the right editor column (allows multiple instances) */
async function openSplitTerminal(): Promise<void> {
	const startupCommand = getConfig<string>('startupCommand', 'snow');

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

	// 1. Create a new terminal in the editor area (initially in current column)
	const terminal = vscode.window.createTerminal({
		name: 'Snow CLI',
		cwd: workspaceFolder,
		location: vscode.TerminalLocation.Editor,
	});

	// 2. Show the terminal first
	terminal.show();

	// 3. Move the terminal to the right group (creates right split if needed)
	await vscode.commands.executeCommand(
		'workbench.action.moveEditorToRightGroup',
	);

	if (startupCommand) {
		terminal.sendText(startupCommand);
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Snow CLI extension activating...');

	// 0. Apply context key for sidebar visibility
	applySidebarContext();

	try {
		// 1. 启动 WebSocket 服务器
		startWebSocketServer();
	} catch (err) {
		console.error('Failed to start WebSocket server:', err);
	}

	try {
		// 2. 注册 Diff 命令
		const diffDisposables = registerDiffCommands(context);
		context.subscriptions.push(...diffDisposables);
	} catch (err) {
		console.error('Failed to register diff commands:', err);
	}

	try {
		// 3. 注册 Sidebar Terminal Provider (always register; view visibility controlled by 'when' clause)
		const startupCommand = getConfig<string>('startupCommand', 'snow');
		sidebarProvider = new SidebarTerminalProvider(
			context.extensionUri,
			startupCommand,
		);
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				SidebarTerminalProvider.viewType,
				sidebarProvider,
				{webviewOptions: {retainContextWhenHidden: true}},
			),
		);
	} catch (err) {
		console.error('Failed to register sidebar terminal:', err);
	}

	// 4. 注册命令
	context.subscriptions.push(
		vscode.commands.registerCommand('snow-cli.openTerminal', () => {
			const mode = getConfig<string>('terminalMode', 'split');
			if (mode === 'sidebar') {
				vscode.commands.executeCommand('snowCliTerminal.focus');
			} else {
				openSplitTerminal();
			}
		}),
		vscode.commands.registerCommand('snow-cli.focusSidebar', () => {
			const mode = getConfig<string>('terminalMode', 'split');
			if (mode === 'sidebar') {
				vscode.commands.executeCommand('snowCliTerminal.focus');
			} else {
				openSplitTerminal();
			}
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

	// 6. 监听配置变化
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('snow-cli.terminalMode')) {
				applySidebarContext();
				vscode.window
					.showInformationMessage(
						'Snow CLI: Terminal mode changed. Please reload the window for full effect.',
						'Reload',
					)
					.then(choice => {
						if (choice === 'Reload') {
							vscode.commands.executeCommand('workbench.action.reloadWindow');
						}
					});
			}

			if (e.affectsConfiguration('snow-cli.startupCommand')) {
				const newCommand = getConfig<string>('startupCommand', 'snow');
				sidebarProvider?.setStartupCommand(newCommand);
			}
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
