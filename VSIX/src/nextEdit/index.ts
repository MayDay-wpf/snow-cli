import * as vscode from 'vscode';
import {
	NextEditConfig,
	affectsNextEdit,
	readNextEditConfig,
	updateNextEditConfig,
} from './nextEditConfig';
import {NextEditEngine} from './engine';
import {
	createAnchorHintType,
	disposeAnchorHintType,
	buildHoverMessage,
} from './decoration';

import {NextEditStatusBar} from './statusBar';
import {disposeLogger, getLogger, log} from './logger';

let statusBar: NextEditStatusBar | undefined;
let engine: NextEditEngine | undefined;
let currentConfig: NextEditConfig = readNextEditConfig();

function rebuild(context: vscode.ExtensionContext): void {
	if (engine) {
		engine.dispose();
		engine = undefined;
	}
	if (!currentConfig.enabled) {
		log('rebuild: disabled, no engine created');
		return;
	}
	statusBar?.setConfig(currentConfig);
	engine = new NextEditEngine(statusBar!);
	engine.updateConfig(currentConfig);
	context.subscriptions.push({dispose: () => engine?.dispose()});
	log('rebuild: engine ready');
}

async function commandToggle(context: vscode.ExtensionContext): Promise<void> {
	const next = !currentConfig.enabled;
	await updateNextEditConfig('enabled', next);
	currentConfig = readNextEditConfig();
	statusBar?.setConfig(currentConfig);
	rebuild(context);
	vscode.window.showInformationMessage(
		`Snow CLI Next Edit Prediction ${next ? 'enabled' : 'disabled'}.`,
	);
}

export function registerNextEdit(context: vscode.ExtensionContext): void {
	currentConfig = readNextEditConfig();

	// Create the shared anchor-hint decoration type AS EARLY AS POSSIBLE.
	// VS Code renders multiple end-of-line `after` decorations in the order
	// their decoration types were created. By owning a type slot here, before
	// gitBlameProvider (or any other after-line annotator) gets a chance to
	// register theirs, we guarantee the Snow Next pill is rendered closer to
	// the code than the git-blame annotation. See decoration.ts for details.
	createAnchorHintType();

	statusBar = new NextEditStatusBar();
	statusBar.setConfig(currentConfig);
	context.subscriptions.push({dispose: () => statusBar?.dispose()});

	log(
		`registerNextEdit: enabled=${currentConfig.enabled}, scope=${currentConfig.scope}, useLsp=${currentConfig.useLspReferences}`,
	);

	// Register a HoverProvider EARLY so that the Snow Next hover card is
	// rendered before competing hovers (e.g. the bundled gitBlameProvider's
	// inline hover). The hover widget stacks contributions roughly in
	// provider-registration order; registering before gitBlameProvider gives
	// us the top slot. The provider only emits hovers while a session is
	// active and the cursor is on the anchor line.
	context.subscriptions.push(
		vscode.languages.registerHoverProvider('*', {
			provideHover(document, position) {
				const snapshot = engine?.getActiveHoverSnapshot();
				if (!snapshot) return undefined;
				if (document.uri.toString() !== snapshot.anchorUri.toString()) {
					return undefined;
				}
				if (position.line !== snapshot.anchorLine) return undefined;
				return new vscode.Hover(
					buildHoverMessage(snapshot.current, snapshot.remaining),
				);
			},
		}),
	);

	rebuild(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('snow-cli.nextEdit.toggle', () =>
			commandToggle(context),
		),
		vscode.commands.registerCommand('snow-cli.nextEdit.accept', async () => {
			if (!engine?.hasActiveSession()) {
				// Forward to default Tab behaviour.
				await vscode.commands.executeCommand('tab');
				return;
			}
			await engine.accept();
		}),
		vscode.commands.registerCommand('snow-cli.nextEdit.next', async () => {
			if (!engine?.hasActiveSession()) return;
			await engine.next();
		}),
		vscode.commands.registerCommand('snow-cli.nextEdit.dismiss', () => {
			engine?.dismiss();
		}),
		vscode.commands.registerCommand('snow-cli.nextEdit.trigger', async () => {
			if (!engine) {
				vscode.window.showInformationMessage(
					'Snow CLI Next Edit Prediction is disabled. Enable it in settings first.',
				);
				return;
			}
			await engine.triggerManual();
		}),
		vscode.commands.registerCommand('snow-cli.nextEdit.showLogs', () => {
			getLogger().show(true);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (!affectsNextEdit(e)) return;
			const next = readNextEditConfig();
			const requiresRebuild = next.enabled !== currentConfig.enabled;
			currentConfig = next;
			statusBar?.setConfig(next);
			if (requiresRebuild) {
				rebuild(context);
			} else {
				engine?.updateConfig(next);
			}
		}),
	);
}

export function disposeNextEdit(): void {
	engine?.dispose();
	engine = undefined;
	statusBar?.dispose();
	statusBar = undefined;
	disposeAnchorHintType();
	disposeLogger();
}
