/**
 * 游戏插件加载器。
 *
 * 架构与 customHeaders 和 statusline hook 加载器一致：
 *   - 内置游戏与外部插件按 id 合并，外部插件可覆盖同 id 的内置游戏。
 *   - 外部插件从 `~/.snow/plugin/games/` 懒加载，支持 `.js` / `.mjs` / `.cjs`。
 *   - 加载失败只 warn，不中断其他插件。
 */
import {existsSync, readdirSync} from 'node:fs';
import {extname, join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {GAMES_PLUGIN_DIR} from '../../config/apiConfig.js';
import {logger} from '../../core/logger.js';
import {snakeGamePlugin} from './builtin/snake.js';
import type {GamePlugin, GamePluginModule} from './types.js';

const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** 内置游戏列表 */
const BUILTIN_GAMES: GamePlugin[] = [snakeGamePlugin as GamePlugin];

/**
 * 类型守卫：验证一个候选对象是否符合 GamePlugin 基本合约。
 */
function isGamePlugin(candidate: unknown): candidate is GamePlugin {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const c = candidate as Partial<GamePlugin>;
	return (
		typeof c.id === 'string' &&
		c.id.length > 0 &&
		typeof c.name === 'string' &&
		c.name.length > 0 &&
		typeof c.init === 'function' &&
		typeof c.handleInput === 'function' &&
		typeof c.tick === 'function' &&
		typeof c.render === 'function' &&
		typeof c.getStatus === 'function'
	);
}

function isPluginEnabled(plugin: GamePlugin): boolean {
	return plugin.enable !== false;
}

/**
 * 从模块导出中收集所有有效的 GamePlugin。
 */
function collectFromModule(mod: GamePluginModule): GamePlugin[] {
	const candidates: unknown[] = [];
	const pushOne = (val: unknown) => {
		if (Array.isArray(val)) candidates.push(...val);
		else if (val !== undefined && val !== null) candidates.push(val);
	};
	pushOne(mod.default);
	pushOne(mod.game);
	pushOne(mod.games);
	return candidates.filter(isGamePlugin);
}

/**
 * 加载外部游戏插件（从 `~/.snow/plugin/games/` 目录）。
 * 返回所有有效插件的数组。
 */
export async function loadExternalGamePlugins(): Promise<GamePlugin[]> {
	if (!existsSync(GAMES_PLUGIN_DIR)) {
		return [];
	}

	let entries: Array<import('node:fs').Dirent>;
	try {
		entries = readdirSync(GAMES_PLUGIN_DIR, {withFileTypes: true});
	} catch (error) {
		logger.warn('Failed to read games plugin directory', {
			directory: GAMES_PLUGIN_DIR,
			error,
		});
		return [];
	}

	const files = entries
		.filter(
			e => e.isFile() && SUPPORTED_EXTENSIONS.has(extname(e.name).toLowerCase()),
		)
		.sort((a, b) => a.name.localeCompare(b.name));

	const plugins: GamePlugin[] = [];

	for (const file of files) {
		const modulePath = join(GAMES_PLUGIN_DIR, file.name);
		try {
			const moduleUrl = pathToFileURL(modulePath).href;
			const mod = (await import(moduleUrl)) as GamePluginModule;
			const collected = collectFromModule(mod);
			if (collected.length === 0) {
				logger.warn(
					`[games] plugin "${file.name}" did not export a valid GamePlugin`,
				);
				continue;
			}
			for (const plugin of collected) {
				if (!isPluginEnabled(plugin)) continue;
				plugins.push(plugin);
			}
		} catch (error) {
			logger.warn(`[games] failed to load plugin "${file.name}":`, {error});
		}
	}

	return plugins;
}

/**
 * 合并内置游戏与外部插件。
 * 外部插件的 id 与内置游戏相同时，外部插件覆盖内置游戏。
 */
export function mergeGamePlugins(
	externalPlugins: GamePlugin[],
): GamePlugin[] {
	const merged = new Map<string, GamePlugin>();

	// 先放内置游戏
	for (const game of BUILTIN_GAMES) {
		merged.set(game.id, game);
	}

	// 外部插件覆盖同 id 的内置游戏
	for (const plugin of externalPlugins) {
		merged.set(plugin.id, plugin);
	}

	return Array.from(merged.values());
}

/**
 * 获取内置游戏列表（同步，用于立即显示菜单）。
 */
export function getBuiltinGames(): GamePlugin[] {
	return BUILTIN_GAMES;
}
