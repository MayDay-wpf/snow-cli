/**
 * 游戏插件类型定义。
 *
 * 架构与 statusline hook、custom_headers 插件保持一致：
 *   - 插件文件放在 `~/.snow/plugin/games/` 目录下，支持 `.js` / `.mjs` / `.cjs`。
 *   - 模块可导出 `default`、`game` 或 `games`（单个对象或数组）。
 *   - `enable: false` 会跳过该插件。
 *
 * 每个游戏插件负责提供元数据（id/name/description）和游戏循环逻辑。
 * 游戏循环通过 `tick()` 推进状态、`render()` 返回终端可渲染的字符串行数组，
 * `handleInput()` 接收按键并更新状态。
 *
 * `description` 支持多语言：可传入纯字符串（所有语言通用），
 * 也可传入 `Partial<Record<Language, string>>` 按语言分别提供描述文本，
 * 运行时根据用户语言设置自动选择最合适的文本。
 */

import type {Language} from '../../config/languageConfig.js';

/**
 * 游戏状态类型——每个游戏自行定义具体结构，这里用 unknown 兜底。
 * 插件内部将其 narrow 为自己的 GameState。
 */
export type GameGameState = unknown;

/**
 * 游戏输入按键描述。
 * `key` 是 ink useInput 的 key 对象子集，`input` 是原始字符。
 */
export interface GameInput {
	input: string;
	key: {
		upArrow: boolean;
		downArrow: boolean;
		leftArrow: boolean;
		rightArrow: boolean;
		return: boolean;
		escape: boolean;
		backspace: boolean;
		delete: boolean;
		ctrl: boolean;
		shift: boolean;
		meta: boolean;
	};
}

/**
 * 游戏初始化参数。
 */
export interface GameInitContext {
	/** 终端宽度，供游戏自行决定渲染宽度 */
	terminalWidth: number;
	/** 终端高度，供游戏自行决定渲染高度 */
	terminalHeight: number;
}

/**
 * 游戏渲染结果——一组字符串行，每行对应终端一行。
 * GameRunner 会用 <Text> 逐行渲染。
 */
export type GameRenderResult = string[];

/**
 * 游戏状态查询结果。
 */
export type GameStatus = 'playing' | 'gameover' | 'won' | 'paused';

/**
 * 游戏插件定义。
 */
export interface GamePlugin<S = GameGameState> {
	/** 全局唯一 id，用于内部索引 */
	id: string;
	/** 显示名称 */
	name: string;
	/**
	 * 简短描述，显示在游戏列表中。
	 * 支持多语言：传入纯字符串则所有语言通用，
	 * 传入 `Partial<Record<Language, string>>` 则按语言选择对应描述。
	 * 找不到当前语言的描述时，按 en → 第一个可用语言的优先级回退。
	 */
	description?: string | Partial<Record<Language, string>>;
	/** 作者信息 */
	author?: string;
	/** 版本号 */
	version?: string;
	/** 是否启用，默认 true */
	enable?: boolean;

	/**
	 * 初始化游戏状态。
	 * 在游戏开始时调用一次。
	 */
	init(ctx: GameInitContext): S;

	/**
	 * 处理用户输入，返回更新后的状态。
	 * 不要在此函数中直接修改 React state——返回新状态即可。
	 */
	handleInput(state: S, input: GameInput): S;

	/**
	 * 推进游戏逻辑（每个 tick 调用一次）。
	 * 返回更新后的状态。若返回 null 表示状态不变。
	 */
	tick(state: S): S | null;

	/**
	 * 渲染当前状态为字符串行数组。
	 */
	render(state: S): GameRenderResult;

	/**
	 * 查询当前游戏状态。
	 */
	getStatus(state: S): GameStatus;

	/**
	 * 获取要显示在底部的提示文本（操作说明等）。
	 */
	getHint?(state: S): string;

	/**
	 * 获取分数文本（如适用）。
	 */
	getScore?(state: S): string | number | null;
}

/**
 * 用户插件模块的导出形状。
 */
export type GamePluginModule = {
	default?: unknown;
	game?: unknown;
	games?: unknown;
};

/**
 * 根据当前语言从插件的 description 字段中提取描述文本。
 *
 * - 若 description 为纯字符串，直接返回。
 * - 若为多语言映射，优先取当前语言对应文本；
 *   找不到时按 en → 第一个可用语言的优先级回退。
 * - 若 description 未定义，返回 undefined。
 *
 * @param description 插件的 description 字段
 * @param language    当前用户语言
 */
export function getLocalizedDescription(
	description: string | Partial<Record<Language, string>> | undefined,
	language: Language,
): string | undefined {
	if (description === undefined) {
		return undefined;
	}
	if (typeof description === 'string') {
		return description;
	}
	return (
		description[language] ?? description.en ?? Object.values(description)[0]
	);
}

/**
 * 将任意值安全转换为可被 React 渲染的字符串。
 *
 * 外部插件是运行时动态加载的 JS 文件，TypeScript 类型约束在运行时无效。
 * 当插件的 name / author / getHint() / getScore() / render() 等返回了
 * 多语言对象 `{en, zh, zh-TW}` 或其他非字符串值时，直接传入 React 子节点
 * 会触发 "Objects are not valid as a React child" 闪退。
 *
 * 此函数做防御性降级：
 *   - string / number → 直接转字符串
 *   - 多语言对象 `{en, zh, 'zh-TW', ...}` → 取 en，再取第一个可用值
 *   - 数组 → 逐元素递归后 join
 *   - null / undefined / object / boolean → 空字符串（避免闪退）
 *
 * @param value 插件返回的任意值
 * @returns 可安全渲染的字符串
 */
export function safeText(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number') {
		return String(value);
	}
	// 多语言对象：Partial<Record<Language, string>>
	if (typeof value === 'object' && !Array.isArray(value)) {
		const record = value as Record<string, unknown>;
		// 优先取 en，其次取第一个可用值
		const en = record['en'];
		if (typeof en === 'string') {
			return en;
		}
		const values = Object.values(record);
		const first = values.find(v => typeof v === 'string');
		if (typeof first === 'string') {
			return first;
		}
		return '';
	}
	if (Array.isArray(value)) {
		return value
			.map(item => safeText(item))
			.filter(Boolean)
			.join('');
	}
	// boolean / symbol / bigint / function 等——避免闪退
	return '';
}
