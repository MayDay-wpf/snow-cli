/**
 * 游戏插件系统公共入口。
 *
 * 导出类型、加载器函数和内置游戏，供 UI 层使用。
 */
export type {
	GameGameState,
	GameInput,
	GameInitContext,
	GamePlugin,
	GameRenderResult,
	GameRenderLine,
	GameRenderSegment,
	GamePluginModule,
	GameStatus,
} from './types.js';

export {
	getLocalizedDescription,
	safeText,
	DEFAULT_TICK_INTERVAL_MS,
} from './types.js';

export {
	loadExternalGamePlugins,
	mergeGamePlugins,
	getBuiltinGames,
} from './loader.js';

export {snakeGamePlugin} from './builtin/snake.js';
export {SNAKE_TICK_INTERVAL_MS} from './builtin/snake.js';
