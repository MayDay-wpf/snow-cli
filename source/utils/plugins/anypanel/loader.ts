/**
 * AnyPanel 插件加载器。
 *
 * 架构与 games loader 和 statusline hook 加载器一致：
 *   - 插件从 `~/.snow/plugin/anypanel/` 懒加载，支持 `.js` / `.mjs` / `.cjs`。
 *   - 加载失败只 warn，不中断其他插件。
 *   - 按 id 索引，后加载的同 id 插件覆盖先加载的。
 */

import {existsSync, readdirSync} from 'node:fs';
import {extname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {ANYPANEL_PLUGIN_DIR} from '../../config/apiConfig.js';
import {logger} from '../../core/logger.js';
import type {AnyPanelPlugin, AnyPanelPluginModule} from './types.js';

export const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * 类型守卫：验证一个候选对象是否符合 AnyPanelPlugin 基本合约。
 */
function isAnyPanelPlugin(candidate: unknown): candidate is AnyPanelPlugin {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const c = candidate as Partial<AnyPanelPlugin>;
	return (
		typeof c.id === 'string' &&
		c.id.length > 0 &&
		typeof c.name === 'string' &&
		c.name.length > 0 &&
		typeof c.init === 'function' &&
		typeof c.handleInput === 'function' &&
		// 渲染方法：render（富文本）或 getRenderLines（纯文本）至少有一个
		(typeof c.render === 'function' ||
			typeof c.getRenderLines === 'function') &&
		typeof c.getStatus === 'function'
	);
}

function isPluginEnabled(plugin: AnyPanelPlugin): boolean {
	return plugin.enable !== false;
}

/**
 * 从模块导出中收集所有有效的 AnyPanelPlugin。
 */
function collectFromModule(mod: AnyPanelPluginModule): AnyPanelPlugin[] {
	const candidates: unknown[] = [];
	const pushOne = (val: unknown) => {
		if (Array.isArray(val)) candidates.push(...val);
		else if (val !== undefined && val !== null) candidates.push(val);
	};
	pushOne(mod.default);
	pushOne(mod.anyPanel);
	pushOne(mod.anyPanels);
	return candidates.filter(isAnyPanelPlugin);
}

/**
 * 加载外部 AnyPanel 插件（从 `~/.snow/plugin/anypanel/` 目录）。
 * 返回所有有效插件的数组。
 *
 * @param bustCache 为 true 时在模块 URL 后追加随机查询参数，
 *   绕过 Node ESM 模块缓存以实现热重载。默认 false。
 */
export async function loadAnyPanelPlugins(
	bustCache = false,
): Promise<AnyPanelPlugin[]> {
	if (!existsSync(ANYPANEL_PLUGIN_DIR)) {
		return [];
	}

	let entries: Array<import('node:fs').Dirent>;
	try {
		entries = readdirSync(ANYPANEL_PLUGIN_DIR, {withFileTypes: true});
	} catch (error) {
		logger.warn('Failed to read anypanel plugin directory', {
			directory: ANYPANEL_PLUGIN_DIR,
			error,
		});
		return [];
	}

	const files = entries
		.filter(
			e =>
				e.isFile() && SUPPORTED_EXTENSIONS.has(extname(e.name).toLowerCase()),
		)
		.sort((a, b) => a.name.localeCompare(b.name));

	const plugins: AnyPanelPlugin[] = [];

	for (const file of files) {
		const modulePath = join(ANYPANEL_PLUGIN_DIR, file.name);
		try {
			let moduleUrl = pathToFileURL(modulePath).href;
			if (bustCache) {
				// 追加随机查询参数绕过 ESM 模块缓存，实现热重载
				moduleUrl += `?t=${Date.now()}`;
			}
			const mod = (await import(moduleUrl)) as AnyPanelPluginModule;
			const collected = collectFromModule(mod);
			if (collected.length === 0) {
				logger.warn(
					`[anypanel] plugin "${file.name}" did not export a valid AnyPanelPlugin`,
				);
				continue;
			}
			for (const plugin of collected) {
				if (!isPluginEnabled(plugin)) continue;
				plugins.push(plugin);
			}
		} catch (error) {
			logger.warn(`[anypanel] failed to load plugin "${file.name}":`, {error});
		}
	}

	return plugins;
}

/**
 * 按 id 索引插件列表，后加载的同 id 插件覆盖先加载的。
 */
export function indexAnyPanelPlugins(
	plugins: AnyPanelPlugin[],
): Map<string, AnyPanelPlugin> {
	const map = new Map<string, AnyPanelPlugin>();
	for (const plugin of plugins) {
		map.set(plugin.id, plugin);
	}
	return map;
}
