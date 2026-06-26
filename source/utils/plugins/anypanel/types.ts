/**
 * AnyPanel 插件类型定义。
 *
 * 架构与 statusline hook、games 插件保持一致：
 *   - 插件文件放在 `~/.snow/plugin/anypanel/` 目录下，支持 `.js` / `.mjs` / `.cjs`。
 *   - 模块可导出 `default`、`anyPanel` 或 `anyPanels`（单个对象或数组）。
 *   - `enable: false` 会跳过该插件。
 *
 * 每个插件负责渲染一个全屏面板（通过 React 组件）。
 * 插件返回的是字符串行数组，由 AnyPanelScreen 逐行渲染，
 * 类似 GamePlugin 的 render() 机制，但面板没有游戏循环——
 * 渲染由插件自行决定何时刷新（通过 getRenderLines 返回最新画面）。
 *
 * 交互模型：
 *   - handleInput() 接收按键并更新内部状态
 *   - getRenderLines() 返回当前画面（字符串行数组）
 *   - getStatus() 返回面板状态（active 表示继续交互，done 表示关闭面板）
 *
 * `description` / `title` 支持多语言：可传入纯字符串（所有语言通用），
 * 也可传入 `Partial<Record<Language, string>>` 按语言分别提供文本，
 * 运行时根据用户语言设置自动选择最合适的文本。
 */

import type {Language} from '../../config/languageConfig.js';

/**
 * 面板初始化上下文——传入终端尺寸和用户语言等信息。
 */
export interface AnyPanelInitContext {
	/** 终端宽度，供面板自行决定渲染宽度 */
	terminalWidth: number;
	/** 终端高度，供面板自行决定渲染高度 */
	terminalHeight: number;
	/** 当前用户语言 */
	language: Language;
	/** 当前工作目录 */
	cwd: string;
}

/**
 * 面板输入按键描述。
 * `key` 是 ink useInput 的 key 对象子集，`input` 是原始字符。
 *
 * 扩展按键（tab / pageUp / pageDown / home / end）均由 vendor/ink 的
 * use-input.ts 在 parseKeypress 解析转义序列后直接填入 key 对象，
 * AnyPanelScreen 无需额外监听 stdin raw data。
 */
export interface AnyPanelInput {
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
		/** Tab 键 */
		tab: boolean;
		/** PageUp 键 */
		pageUp: boolean;
		/** PageDown 键 */
		pageDown: boolean;
		/** Home 键 */
		home: boolean;
		/** End 键 */
		end: boolean;
	};
}

/**
 * 面板渲染结果——一组字符串行，每行对应终端一行。
 * AnyPanelScreen 会用 <Text> 逐行渲染。
 */
export type AnyPanelRenderResult = string[];

/**
 * 面板状态查询结果。
 * - 'active': 面板继续运行，等待下一次输入
 * - 'done': 面板请求关闭（如用户按了确认/退出键）
 */
export type AnyPanelStatus = 'active' | 'done';

/**
 * 注入给插件 render() 方法的运行时上下文。
 *
 * 外部 `.mjs` 插件文件无法 `import React` / `import ink`，
 * 所以 AnyPanelScreen 在调用 render() 时把 React 和 ink 组件
 * 通过此上下文注入进来，让插件能用 JSX-free 的写法构建富文本界面：
 *
 * ```js
 * render(state, ctx) {
 *   const { React, Box, Text, theme } = ctx;
 *   return React.createElement(Box, {flexDirection: 'column'},
 *     React.createElement(Text, {color: theme.colors.success}, 'Hello'),
 *   );
 * }
 * ```
 *
 * 同时也注入了 `forceRerender()` 方法，允许插件在异步操作完成后
 * 主动触发重绘（例如网络请求返回后）。
 */
export interface AnyPanelRenderContext {
	/** React 命名空间，用于 React.createElement / React.Fragment 等 */
	React: typeof import('react');
	/** ink 的 Box 组件 */
	Box: typeof import('ink').Box;
	/** ink 的 Text 组件 */
	Text: typeof import('ink').Text;
	/** ink 的 Newline 组件 */
	Newline: typeof import('ink').Newline;
	/** ink 的 Spacer 组件 */
	Spacer: typeof import('ink').Spacer;
	/** 当前主题的完整颜色配置 */
	theme: import('../../../ui/themes/index.js').Theme;
	/** 当前用户语言 */
	language: Language;
	/** 终端宽度 */
	terminalWidth: number;
	/**
	 * 请求 AnyPanelScreen 重新渲染。
	 * 用于异步操作（如 fetch 完成后）需要刷新画面的场景。
	 */
	forceRerender: () => void;
}

/**
 * render() 方法返回值——可以是任意 React 节点。
 */
export type AnyPanelReactResult = import('react').ReactNode;

/**
 * AnyPanel 插件定义。
 *
 * 与 GamePlugin 的主要区别：
 *   - 没有 tick() 游戏循环——面板是事件驱动的（按键触发渲染）
 *   - 没有分数/游戏结束概念——面板通过 getStatus() 返回 'done' 请求关闭
 *   - 面板自行管理内部状态，AnyPanelScreen 只负责桥接 ink 输入和渲染
 *
 * 渲染有两种模式（插件至少实现其一）：
 *   1. **富文本模式**（推荐）：实现 `render(state, ctx)`，通过注入的
 *      React + ink 组件构建带颜色、边框、布局的界面。
 *   2. **纯文本模式**（向后兼容）：实现 `getRenderLines(state)`，返回
 *      字符串行数组，AnyPanelScreen 用 `<Text>` 逐行渲染。
 *
 * 若两者都存在，优先使用 `render()`。
 */
export interface AnyPanelPlugin<S = unknown> {
	/** 全局唯一 id，用于内部索引和自定义指令关联 */
	id: string;
	/** 显示名称 */
	name: string;
	/**
	 * 简短描述，显示在面板标题中。
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
	 * 定时刷新间隔（毫秒）。
	 * 设置后面板会按此间隔定时触发重绘，无需用户按键。
	 * 适用于实时监控面板（如进程监控、日志流、系统资源等）。
	 * 最小有效值为 100ms，低于此值会被截断到 100ms。
	 * 未设置时面板为纯事件驱动（仅按键触发重绘）。
	 */
	refreshIntervalMs?: number;

	/**
	 * 初始化面板状态。
	 * 在面板打开时调用一次（onMount 之前）。
	 * 返回的 state 由插件自行管理，AnyPanelScreen 不关心其具体结构。
	 */
	init(ctx: AnyPanelInitContext): S;

	/**
	 * 处理用户输入，返回更新后的状态。
	 * 不要在此函数中直接修改 React state——返回新状态即可。
	 */
	handleInput(state: S, input: AnyPanelInput): S;

	/**
	 * 富文本渲染（推荐）。
	 *
	 * 通过 ctx 中注入的 React + ink 组件构建界面。
	 * AnyPanelScreen 优先调用此方法；若不存在则回退到 getRenderLines。
	 *
	 * @param state  当前面板状态
	 * @param ctx    渲染上下文（注入 React、ink 组件、主题色、forceRerender）
	 */
	render?(state: S, ctx: AnyPanelRenderContext): AnyPanelReactResult;

	/**
	 * 纯文本渲染（向后兼容）。
	 *
	 * 渲染当前状态为字符串行数组，每行对应终端一行。
	 * 当插件未实现 render() 时使用此方法。
	 */
	getRenderLines?(state: S): AnyPanelRenderResult;

	/**
	 * 查询当前面板状态。
	 * 返回 'done' 时 AnyPanelScreen 会关闭面板。
	 */
	getStatus(state: S): AnyPanelStatus;

	/**
	 * 获取要显示在底部的提示文本（操作说明等）。
	 */
	getHint?(state: S): string;

	// --- 生命周期钩子（全部可选）---

	/**
	 * 面板挂载后调用（init 之后）。
	 * 适合启动异步任务、打开连接等。
	 */
	onMount?(state: S): void;

	/**
	 * 面板关闭前调用。
	 * 适合清理定时器、关闭连接、释放资源等。
	 * 此钩子在面板关闭时（ESC / getStatus 返回 'done' / 组件卸载）触发，
	 * 且仅调用一次——若已通过面板关闭流程调用，组件卸载 cleanup 不会重复调用。
	 */
	onUnmount?(state: S): void;

	/**
	 * 面板获得焦点时调用。
	 * 当前实现在面板挂载时（onMount 之后）调用一次。
	 */
	onFocus?(state: S): void;

	/**
	 * 面板失去焦点时调用。
	 * 当前实现在面板关闭前（onUnmount 之前）调用一次。
	 */
	onBlur?(state: S): void;
}

/**
 * 用户插件模块的导出形状。
 */
export type AnyPanelPluginModule = {
	default?: unknown;
	anyPanel?: unknown;
	anyPanels?: unknown;
};

/**
 * 根据当前语言从插件的 description/title 字段中提取文本。
 *
 * - 若文本为纯字符串，直接返回。
 * - 若为多语言映射，优先取当前语言对应文本；
 *   找不到时按 en → 第一个可用语言的优先级回退。
 * - 若文本未定义，返回 undefined。
 *
 * @param text       插件的 description / title 字段
 * @param language    当前用户语言
 */
export function getLocalizedText(
	text: string | Partial<Record<Language, string>> | undefined,
	language: Language,
): string | undefined {
	if (text === undefined) {
		return undefined;
	}
	if (typeof text === 'string') {
		return text;
	}
	return text[language] ?? text.en ?? Object.values(text)[0];
}

/**
 * 将任意值安全转换为可被 React 渲染的字符串。
 *
 * 外部插件是运行时动态加载的 JS 文件，TypeScript 类型约束在运行时无效。
 * 当插件的 name / author / getHint() / getRenderLines() 等返回了
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
