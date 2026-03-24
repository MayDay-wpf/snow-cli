import {existsSync, readdirSync} from 'node:fs';
import {extname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React from 'react';
import {STATUSLINE_HOOKS_DIR} from '../../../../utils/config/apiConfig.js';
import {logger} from '../../../../utils/core/logger.js';
import {gitBranchStatusLineHook} from './gitBranch.js';
import type {
	StatusLineHookContext,
	StatusLineHookDefinition,
	StatusLineRenderItem,
} from './types.js';

const DEFAULT_STATUSLINE_HOOK_REFRESH_INTERVAL_MS = 5000;
const SUPPORTED_STATUSLINE_HOOK_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const BUILTIN_STATUSLINE_HOOKS: StatusLineHookDefinition[] = [
	gitBranchStatusLineHook,
];

type StatusLineHookModule = {
	default?: unknown;
	statusLineHook?: unknown;
	statusLineHooks?: unknown;
};

function isStatusLineHookDefinition(
	candidate: unknown,
): candidate is StatusLineHookDefinition {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof (candidate as StatusLineHookDefinition).id === 'string' &&
		typeof (candidate as StatusLineHookDefinition).getItems === 'function'
	);
}

function isHookEnabled(hook: StatusLineHookDefinition): boolean {
	return hook.enable !== false;
}

function normalizeStatusLineRenderItem(
	hookId: string,
	item: StatusLineRenderItem,
	index: number,
): StatusLineRenderItem {
	return {
		...item,
		id: item.id?.trim() || `${hookId}:${index}`,
	};
}

function normalizeStatusLineItems(
	hookId: string,
	result: StatusLineRenderItem | StatusLineRenderItem[] | undefined | null,
): StatusLineRenderItem[] {
	if (!result) {
		return [];
	}

	const items = Array.isArray(result) ? result : [result];
	return items
		.filter(
			item => typeof item?.text === 'string' && item.text.trim().length > 0,
		)
		.map((item, index) => normalizeStatusLineRenderItem(hookId, item, index));
}

function normalizeStatusLineHookExports(
	moduleExports: StatusLineHookModule,
	modulePath: string,
): StatusLineHookDefinition[] {
	const exportedHooks = [
		moduleExports.default,
		moduleExports.statusLineHook,
		moduleExports.statusLineHooks,
	].filter(Boolean);

	if (exportedHooks.length === 0) {
		logger.warn('Status line hook module has no supported export', {
			modulePath,
		});
		return [];
	}

	const hooks = exportedHooks.flatMap(exportedHook =>
		Array.isArray(exportedHook) ? exportedHook : [exportedHook],
	);

	return hooks.filter(hook => {
		const isValid = isStatusLineHookDefinition(hook);
		if (!isValid) {
			logger.warn('Ignoring invalid status line hook export', {modulePath});
		}

		return isValid;
	});
}

async function loadExternalStatusLineHooks(): Promise<
	StatusLineHookDefinition[]
> {
	if (!existsSync(STATUSLINE_HOOKS_DIR)) {
		return [];
	}

	let entries: Array<import('node:fs').Dirent>;
	try {
		entries = readdirSync(STATUSLINE_HOOKS_DIR, {withFileTypes: true});
	} catch (error) {
		logger.warn('Failed to read status line hook directory', {
			directory: STATUSLINE_HOOKS_DIR,
			error,
		});
		return [];
	}

	const moduleFiles = entries
		.filter(
			entry =>
				entry.isFile() &&
				SUPPORTED_STATUSLINE_HOOK_EXTENSIONS.has(extname(entry.name)),
		)
		.sort((left, right) => left.name.localeCompare(right.name));

	const hooks: StatusLineHookDefinition[] = [];
	for (const moduleFile of moduleFiles) {
		const modulePath = join(STATUSLINE_HOOKS_DIR, moduleFile.name);
		try {
			const moduleUrl = pathToFileURL(modulePath).href;
			const importedModule = (await import(moduleUrl)) as StatusLineHookModule;
			hooks.push(...normalizeStatusLineHookExports(importedModule, modulePath));
		} catch (error) {
			logger.warn('Failed to load status line hook module', {
				modulePath,
				error,
			});
		}
	}

	return hooks;
}

function mergeStatusLineHooks(
	externalHooks: StatusLineHookDefinition[],
): StatusLineHookDefinition[] {
	const mergedHooks = new Map<string, StatusLineHookDefinition>();

	for (const hook of BUILTIN_STATUSLINE_HOOKS) {
		mergedHooks.set(hook.id, hook);
	}

	for (const hook of externalHooks) {
		mergedHooks.set(hook.id, hook);
	}

	return Array.from(mergedHooks.values());
}

function sortStatusLineItems(
	items: StatusLineRenderItem[],
): StatusLineRenderItem[] {
	return [...items].sort((left, right) => {
		const leftPriority = left.priority ?? 0;
		const rightPriority = right.priority ?? 0;
		if (leftPriority !== rightPriority) {
			return leftPriority - rightPriority;
		}

		const leftId = left.id ?? '';
		const rightId = right.id ?? '';
		return leftId.localeCompare(rightId);
	});
}

export function useStatusLineHookItems(
	context: StatusLineHookContext,
): StatusLineRenderItem[] {
	const contextRef = React.useRef(context);
	const [hookDefinitions, setHookDefinitions] = React.useState(
		BUILTIN_STATUSLINE_HOOKS,
	);
	const [itemsByHookId, setItemsByHookId] = React.useState<
		Record<string, StatusLineRenderItem[]>
	>({});

	React.useEffect(() => {
		contextRef.current = context;
	}, [context]);

	React.useEffect(() => {
		let disposed = false;

		const loadHooks = async () => {
			const externalHooks = await loadExternalStatusLineHooks();
			if (!disposed) {
				setHookDefinitions(mergeStatusLineHooks(externalHooks));
			}
		};

		void loadHooks();

		return () => {
			disposed = true;
		};
	}, []);

	React.useEffect(() => {
		const activeHookIds = new Set(hookDefinitions.map(hook => hook.id));
		setItemsByHookId(previousItems => {
			const nextItems = Object.fromEntries(
				Object.entries(previousItems).filter(([hookId]) =>
					activeHookIds.has(hookId),
				),
			);
			return nextItems;
		});
	}, [hookDefinitions]);

	React.useEffect(() => {
		let disposed = false;
		const refreshingHooks = new Set<string>();
		const timers: Array<ReturnType<typeof setInterval>> = [];

		const refreshHook = async (hook: StatusLineHookDefinition) => {
			if (refreshingHooks.has(hook.id)) {
				return;
			}

			refreshingHooks.add(hook.id);
			try {
				const result = await hook.getItems(contextRef.current);
				if (!disposed) {
					setItemsByHookId(previousItems => ({
						...previousItems,
						[hook.id]: normalizeStatusLineItems(hook.id, result),
					}));
				}
			} catch (error) {
				if (!disposed) {
					setItemsByHookId(previousItems => ({
						...previousItems,
						[hook.id]: [],
					}));
				}
				logger.warn('Status line hook refresh failed', {
					hookId: hook.id,
					error,
				});
			} finally {
				refreshingHooks.delete(hook.id);
			}
		};

		for (const hook of hookDefinitions) {
			if (!isHookEnabled(hook)) {
				continue;
			}
			void refreshHook(hook);
			const refreshIntervalMs = Math.max(
				1000,
				hook.refreshIntervalMs ?? DEFAULT_STATUSLINE_HOOK_REFRESH_INTERVAL_MS,
			);
			const timer = setInterval(() => {
				void refreshHook(hook);
			}, refreshIntervalMs);
			timers.push(timer);
		}

		return () => {
			disposed = true;
			for (const timer of timers) {
				clearInterval(timer);
			}
		};
	}, [hookDefinitions]);

	return React.useMemo(
		() => sortStatusLineItems(Object.values(itemsByHookId).flat()),
		[itemsByHookId],
	);
}
