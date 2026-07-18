import * as vscode from 'vscode';
import {
	CompletionConfig,
	affectsCompletion,
	readCompletionConfig,
	updateCompletionConfig,
} from './completionConfig';
import {SnowInlineCompletionProvider} from './completionProvider';
import {CompletionStatusBar} from './statusBar';
import {fetchModelList} from './modelFetcher';
import {disposeLogger, getLogger, log} from './logger';

let currentConfig: CompletionConfig = readCompletionConfig();
let statusBar: CompletionStatusBar | undefined;
let provider: SnowInlineCompletionProvider | undefined;
let providerRegistration: vscode.Disposable | undefined;

function buildSelector(config: CompletionConfig): vscode.DocumentSelector {
	if (
		!config.languages ||
		config.languages.length === 0 ||
		config.languages.includes('*')
	) {
		return [{scheme: 'file'}, {scheme: 'untitled'}, {scheme: 'vscode-remote'}];
	}
	const selectors: vscode.DocumentFilter[] = [];
	for (const lang of config.languages) {
		selectors.push({language: lang, scheme: 'file'});
		selectors.push({language: lang, scheme: 'untitled'});
		selectors.push({language: lang, scheme: 'vscode-remote'});
	}
	return selectors;
}

function rebuildProvider(context: vscode.ExtensionContext): void {
	if (providerRegistration) {
		providerRegistration.dispose();
		providerRegistration = undefined;
	}
	if (provider) {
		provider.dispose();
		provider = undefined;
	}
	if (!currentConfig.enabled) {
		log('rebuildProvider: completion is disabled, not registering provider');
		return;
	}
	provider = new SnowInlineCompletionProvider(() => currentConfig, {
		setLoading: (loading: boolean) => statusBar?.setLoading(loading),
		setMessage: (msg: string | undefined) => statusBar?.setMessage(msg),
	});
	const selector = buildSelector(currentConfig);
	providerRegistration = vscode.languages.registerInlineCompletionItemProvider(
		selector,
		provider,
	);
	context.subscriptions.push(providerRegistration);
	log(
		`rebuildProvider: provider registered for selector ${JSON.stringify(
			selector,
		)}`,
	);
}

async function commandToggle(context: vscode.ExtensionContext): Promise<void> {
	const next = !currentConfig.enabled;
	await updateCompletionConfig('enabled', next);
	currentConfig = readCompletionConfig();
	statusBar?.setConfig(currentConfig);
	rebuildProvider(context);
	vscode.window.showInformationMessage(
		`Snow CLI inline completion ${next ? 'enabled' : 'disabled'}.`,
	);
}

async function commandTrigger(): Promise<void> {
	if (!currentConfig.enabled) {
		const choice = await vscode.window.showInformationMessage(
			'Snow CLI inline completion is disabled. Enable it now?',
			'Enable',
		);
		if (choice === 'Enable') {
			await updateCompletionConfig('enabled', true);
		}
		return;
	}
	await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
}

async function commandSelectModel(): Promise<void> {
	const config = readCompletionConfig();
	if (!config.apiKey) {
		const choice = await vscode.window.showWarningMessage(
			'Snow CLI: API Key is not configured. Open settings to set it now?',
			'Open Settings',
		);
		if (choice === 'Open Settings') {
			await vscode.commands.executeCommand(
				'workbench.action.openSettings',
				'snow-cli.completion.apiKey',
			);
		}
		return;
	}

	const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
	quickPick.title = `Snow CLI · ${config.provider} · Select Completion Model`;
	quickPick.placeholder = 'Loading models from API...';
	quickPick.busy = true;
	quickPick.matchOnDescription = true;
	quickPick.matchOnDetail = true;
	quickPick.show();

	try {
		const models = await fetchModelList(config);
		if (models.length === 0) {
			quickPick.placeholder =
				'No models returned. Type a model id manually and press Enter.';
		} else {
			quickPick.placeholder = 'Pick a model or type to filter';
		}
		const items: vscode.QuickPickItem[] = models.map(m => ({
			label: m.id,
			description: m.label,
			detail: m.description,
		}));
		// Allow manual entry by injecting current model first if not in list.
		if (config.model && !items.some(i => i.label === config.model)) {
			items.unshift({label: config.model, description: 'current'});
		}
		quickPick.items = items;
		quickPick.busy = false;

		const picked = await new Promise<vscode.QuickPickItem | string | undefined>(
			resolve => {
				quickPick.onDidAccept(() => {
					const selection = quickPick.selectedItems[0];
					if (selection) {
						resolve(selection);
					} else {
						resolve(quickPick.value || undefined);
					}
					quickPick.hide();
				});
				quickPick.onDidHide(() => resolve(undefined));
			},
		);

		let chosen: string | undefined;
		if (typeof picked === 'string') chosen = picked;
		else if (picked && 'label' in picked) chosen = picked.label;

		if (chosen) {
			await updateCompletionConfig('model', chosen);
			vscode.window.showInformationMessage(
				`Snow CLI completion model set: ${chosen}`,
			);
		}
	} catch (err: any) {
		quickPick.hide();
		const msg = err?.message ?? String(err);
		vscode.window.showErrorMessage(
			`Snow CLI: failed to load model list — ${msg}`,
		);
	} finally {
		quickPick.dispose();
	}
}

export function registerCompletion(context: vscode.ExtensionContext): void {
	currentConfig = readCompletionConfig();
	statusBar = new CompletionStatusBar();
	statusBar.setConfig(currentConfig);
	context.subscriptions.push({dispose: () => statusBar?.dispose()});

	log(
		`registerCompletion: enabled=${currentConfig.enabled}, provider=${
			currentConfig.provider
		}, model=${currentConfig.model || '(empty)'}, baseUrl=${
			currentConfig.baseUrl || '(default)'
		}, apiKey=${
			currentConfig.apiKey
				? '(set, len=' + currentConfig.apiKey.length + ')'
				: '(empty)'
		}, languages=${JSON.stringify(currentConfig.languages)}`,
	);

	rebuildProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('snow-cli.completion.toggle', () =>
			commandToggle(context),
		),
		vscode.commands.registerCommand('snow-cli.completion.trigger', () =>
			commandTrigger(),
		),
		vscode.commands.registerCommand('snow-cli.completion.selectModel', () =>
			commandSelectModel(),
		),
		vscode.commands.registerCommand('snow-cli.completion.showLogs', () => {
			getLogger().show(true);
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (!affectsCompletion(e)) return;
			const next = readCompletionConfig();
			const requiresRebuild =
				next.enabled !== currentConfig.enabled ||
				JSON.stringify(next.languages) !==
					JSON.stringify(currentConfig.languages);
			currentConfig = next;
			statusBar?.setConfig(next);
			if (requiresRebuild) {
				rebuildProvider(context);
			} else {
				provider?.clearCache();
			}
		}),
	);
}

export function disposeCompletion(): void {
	providerRegistration?.dispose();
	providerRegistration = undefined;
	provider?.dispose();
	provider = undefined;
	statusBar?.dispose();
	statusBar = undefined;
	disposeLogger();
}
