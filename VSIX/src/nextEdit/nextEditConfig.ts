import * as vscode from 'vscode';

export type NextEditScope = 'file' | 'workspace';

export interface NextEditConfig {
	enabled: boolean;
	scope: NextEditScope;
	useLspReferences: boolean;
	maxCandidates: number;
	minPatternLength: number;
	debounceMs: number;
}

const SECTION = 'snow-cli';

function get<T>(key: string, fallback: T): T {
	return vscode.workspace.getConfiguration(SECTION).get<T>(key, fallback) as T;
}

export function readNextEditConfig(): NextEditConfig {
	return {
		enabled: get<boolean>('nextEdit.enabled', false),
		scope: get<NextEditScope>('nextEdit.scope', 'file'),
		useLspReferences: get<boolean>('nextEdit.useLspReferences', true),
		maxCandidates: get<number>('nextEdit.maxCandidates', 20),
		minPatternLength: get<number>('nextEdit.minPatternLength', 2),
		debounceMs: get<number>('nextEdit.debounceMs', 350),
	};
}

export async function updateNextEditConfig<K extends keyof NextEditConfig>(
	key: K,
	value: NextEditConfig[K],
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<void> {
	const settingKey = `nextEdit.${key}`;
	await vscode.workspace
		.getConfiguration(SECTION)
		.update(settingKey, value, target);
}

export function affectsNextEdit(e: vscode.ConfigurationChangeEvent): boolean {
	return e.affectsConfiguration(`${SECTION}.nextEdit`);
}
