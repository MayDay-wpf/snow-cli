import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Box, Text, Newline, Spacer, useInput} from 'ink';
import {existsSync, watch} from 'node:fs';
import {extname} from 'node:path';
import {useI18n} from '../../i18n/index.js';
import type {Language, TranslationKeys} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {ANYPANEL_PLUGIN_DIR} from '../../utils/config/apiConfig.js';
import {
	loadAnyPanelPlugins,
	indexAnyPanelPlugins,
	SUPPORTED_EXTENSIONS,
} from '../../utils/plugins/anypanel/loader.js';
import {
	getLocalizedText,
	safeText,
	type AnyPanelPlugin,
	type AnyPanelInitContext,
	type AnyPanelInput,
	type AnyPanelRenderContext,
} from '../../utils/plugins/anypanel/types.js';
import {logger} from '../../utils/core/logger.js';

const log = logger.child('ui:pages');

/**
 * 可随渲染更新的显示上下文。
 *
 * 与实例身份无关：宽度、语言、会话数据变化只影响渲染和"初始化时的初始值"，
 * 不应触发插件重新加载或 init()，否则会覆盖用户当前状态。
 */
type DisplayContext = {
	terminalWidth: number;
	language: Language;
	sessionId: string;
	sessionJson: string;
	/** 仅用于加载失败时的本地化文案，不参与实例身份判断 */
	t: TranslationKeys;
};

/**
 * 一次面板打开对应的插件实例。
 *
 * plugin / state 会随热更新和输入处理原地更新，instanceRef 始终持有当前实例；
 * initialized 与 state 的具体取值解耦，插件返回 null 也算初始化成功。
 */
type PanelInstance = {
	/** 实例所属插件 id，用于阻止插件切换后的过期异步结果写回 */
	pluginId: string;
	/** 当前插件实现（热更新时替换为最新代码） */
	plugin: AnyPanelPlugin;
	/** 插件状态；有效返回值允许为 null / undefined */
	state: unknown;
	/** init 是否成功完成——不以 state 是否为 null 判断 */
	initialized: boolean;
	/** 是否已失效（关闭或切换后为 true），异步结果不得再写回 */
	disposed: boolean;
	/** onUnmount 是否已调用，保证清理幂等 */
	cleaned: boolean;
};

/**
 * 返回与当前 pluginId 匹配、已完成初始化且未被结束的实例。
 * 插件切换过渡期或关闭后返回 null，避免把旧插件对象与新 state 混用。
 */
function getActiveInstance(
	instance: PanelInstance | null,
	pluginId: string,
): PanelInstance | null {
	if (!instance) return null;
	if (instance.pluginId !== pluginId) return null;
	if (!instance.initialized || instance.disposed) return null;
	return instance;
}

/**
 * 结束一个面板实例：按需调用 onBlur，随后调用 onUnmount 并标记失效。
 *
 * 幂等且不触发 React 状态更新，供关闭流程、插件切换与组件卸载共用，
 * 避免同一实例被重复释放。
 */
function disposeInstance(instance: PanelInstance, callBlur: boolean): void {
	if (instance.cleaned) return;
	instance.cleaned = true;
	instance.disposed = true;
	if (!instance.initialized) return;

	if (callBlur) {
		try {
			instance.plugin.onBlur?.(instance.state);
		} catch (error) {
			log.debug('AnyPanel onBlur failed', {error});
		}
	}

	try {
		instance.plugin.onUnmount?.(instance.state);
	} catch (error) {
		log.debug('AnyPanel onUnmount failed', {error});
	}
}

type Props = {
	/** AnyPanel 插件 id，来自自定义指令的 command 字段 */
	pluginId: string;
	/** 终端宽度 */
	terminalWidth: number;
	/** 关闭面板回调 */
	onClose: () => void;
	/** 当前会话 ID，无上下文时传空字符串 */
	sessionId?: string;
	/** 当前会话的 JSON 原文，无上下文时传空字符串 */
	sessionJson?: string;
};

/**
 * AnyPanel 渲染屏幕。
 *
 * 根据 pluginId 从 ~/.snow/plugin/anypanel/ 加载对应插件，
 * 调用插件的 init/handleInput/getRenderLines/getStatus 进行交互渲染。
 *
 * 与 GameRunner 的区别：
 *   - 没有游戏循环 tick——面板是事件驱动的（按键触发重新渲染）
 *   - 插件自行管理内部状态，本组件只负责桥接 ink 输入和渲染
 *
 * 增强特性：
 *   - 定时刷新：插件设置 refreshIntervalMs 后，面板按间隔定时重绘
 *   - 渲染错误恢复：渲染出错时保留上次成功画面，不关闭面板
 *   - 生命周期钩子：onMount / onUnmount / onFocus / onBlur
 *   - 扩展键盘输入：tab / pageUp / pageDown / home / end（home / end 由
 *     vendor/ink 的 use-input.ts 解析转义序列后直接填入 key 对象）
 */
export default function AnyPanelScreen({
	pluginId,
	terminalWidth,
	onClose,
	sessionId = '',
	sessionJson = '',
}: Props) {
	const {t, language} = useI18n();
	const {theme} = useTheme();

	const [plugin, setPlugin] = useState<AnyPanelPlugin | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [, forceRender] = useState(0);

	// 当前实例——生命周期、输入与异步有效性判断的唯一依据
	const instanceRef = useRef<PanelInstance | null>(null);
	// 面板是否已请求关闭——阻止关闭后的输入、刷新与异步写回
	const closedRef = useRef(false);

	// 最新显示上下文：宽度/语言/会话变化只更新此 ref，不重建实例
	const displayContextRef = useRef<DisplayContext>({
		terminalWidth,
		language,
		sessionId,
		sessionJson,
		t,
	});

	// 上次成功渲染的内容——渲染出错时保留旧画面，不闪退
	const lastContentRef = useRef<React.ReactNode>(null);
	// 当前渲染错误信息——写入 ref（渲染阶段不触发 setState），由 useEffect 同步到 state
	const renderErrorRef = useRef<string | null>(null);
	// 渲染错误信息（非致命：面板继续运行，下次渲染成功后自动清除）
	const [renderError, setRenderError] = useState<string | null>(null);

	// 在提交阶段同步最新上下文：本 effect 声明在加载 effect 之前，
	// 保证加载完成时读到的是最新值；依赖均为稳定原始值，避免每次渲染都写 ref。
	useEffect(() => {
		displayContextRef.current = {
			terminalWidth,
			language,
			sessionId,
			sessionJson,
			t,
		};
	}, [terminalWidth, language, sessionId, sessionJson, t]);

	// 加载并初始化插件实例。
	//
	// 触发条件只有 pluginId：宽度、语言、会话等显示上下文变化只更新渲染，
	// 不重新加载也不重新 init。历史问题正是 terminalWidth 进入依赖后，
	// init() 的初始状态覆盖了用户当前状态，导致拉伸终端时面板重置。
	//
	// 每次打开面板仍强制 bustCache=true，绕过 ESM 模块缓存，
	// 确保开发期修改的插件代码无需重启 CLI 即可生效。
	useEffect(() => {
		// 已请求关闭后不再建立新实例（父组件随后会卸载本组件）
		if (closedRef.current) return;

		let cancelled = false;

		// 插件切换：旧实例按"失去焦点 → 退出"结束，避免 A 的 state 传给 B
		const previous = instanceRef.current;
		if (previous) {
			instanceRef.current = null;
			disposeInstance(previous, true);
		}

		// 新实例建立前重置宿主 UI 状态，避免沿用上一个插件的画面或错误
		setPlugin(null);
		setError(null);
		lastContentRef.current = null;
		renderErrorRef.current = null;
		setRenderError(null);

		(async () => {
			try {
				const plugins = await loadAnyPanelPlugins(true);
				if (cancelled || closedRef.current) return;

				const indexed = indexAnyPanelPlugins(plugins);
				const found = indexed.get(pluginId);
				if (!found) {
					setError(
						displayContextRef.current.t.anyPanel.pluginNotFound.replace(
							'{id}',
							pluginId,
						),
					);
					return;
				}

				// 初始化时读取最新上下文，而不是 effect 执行瞬间捕获的值
				const context = displayContextRef.current;
				const ctx: AnyPanelInitContext = {
					terminalWidth: context.terminalWidth,
					terminalHeight: 40, // 估算值，ink 无法直接获取终端高度
					language: context.language,
					cwd: process.cwd(),
					sessionId: context.sessionId,
					sessionJson: context.sessionJson,
				};

				const state = found.init(ctx);
				if (cancelled || closedRef.current) return;

				const instance: PanelInstance = {
					pluginId,
					plugin: found,
					state,
					initialized: true,
					disposed: false,
					cleaned: false,
				};
				// 先建立宿主记录，再触发生命周期钩子，保证钩子内抛错也能正常清理
				instanceRef.current = instance;
				setPlugin(found);

				// 调用 onMount 生命周期钩子
				try {
					found.onMount?.(state);
				} catch (error) {
					log.debug('AnyPanel onMount failed', {error});
				}
				// 面板挂载即获得焦点
				try {
					found.onFocus?.(state);
				} catch (error) {
					log.debug('AnyPanel onFocus failed', {error});
				}
			} catch (err) {
				if (cancelled || closedRef.current) return;
				setError(
					displayContextRef.current.t.anyPanel.loadError.replace(
						'{error}',
						err instanceof Error ? err.message : String(err),
					),
				);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [pluginId]);

	// 热重载：监听插件目录文件变更，自动重新加载插件代码
	// 编辑器保存（可能触发多次事件）后 debounce 300ms 执行一次
	// 热重载时保留当前实例与 state，不重新 init()，仅替换 plugin 引用
	useEffect(() => {
		if (closedRef.current) return;
		if (!existsSync(ANYPANEL_PLUGIN_DIR)) return;

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		// 重叠 reload 的请求序号：只允许最新一次结果写回
		let reloadSeq = 0;

		const reloadPlugin = async () => {
			const seq = ++reloadSeq;
			try {
				// bustCache=true 绕过 ESM 模块缓存，拿到最新代码
				const plugins = await loadAnyPanelPlugins(true);
				if (cancelled || closedRef.current || seq !== reloadSeq) return;

				const indexed = indexAnyPanelPlugins(plugins);
				const found = indexed.get(pluginId);
				if (!found) return; // 插件被删除或暂时不可用，保持现状

				const instance = instanceRef.current;
				// 初始化未完成、已结束或已切到其他插件时不得发布新代码
				if (
					!instance ||
					instance.pluginId !== pluginId ||
					!instance.initialized ||
					instance.disposed ||
					instance.cleaned
				) {
					return;
				}

				// 热重载保留当前 state，只热替换插件代码
				instance.plugin = found;
				setPlugin(found);
				forceRender(n => n + 1);
			} catch (error) {
				log.debug('AnyPanel reloadPlugin failed', {error});
			}
		};

		const watcher = watch(
			ANYPANEL_PLUGIN_DIR,
			{recursive: false},
			(_eventType, filename) => {
				if (!filename) return;
				// 只关心支持的扩展名文件
				const ext = extname(filename).toLowerCase();
				if (!SUPPORTED_EXTENSIONS.has(ext)) return;
				// debounce：编辑器保存可能触发多次事件
				if (timer) clearTimeout(timer);
				timer = setTimeout(reloadPlugin, 300);
			},
		);

		watcher.on('error', error => {
			log.debug('AnyPanel watcher error', {error});
		});

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
			watcher.close();
		};
	}, [pluginId]);

	// 定时刷新：插件设置 refreshIntervalMs 后按间隔触发重绘
	// 适用于实时监控面板（进程监控、日志流、系统资源等）
	useEffect(() => {
		if (!plugin?.refreshIntervalMs) return;
		// 最小 100ms，防止过高频率导致 CPU 占满
		const interval = Math.max(100, plugin.refreshIntervalMs);
		const timer = setInterval(() => {
			if (closedRef.current) return;
			// 热更新可能已替换 plugin，只有当前实例仍指向该实现时才重绘
			const instance = instanceRef.current;
			if (!instance || instance.plugin !== plugin || instance.disposed) return;
			forceRender(n => n + 1);
		}, interval);
		return () => clearInterval(timer);
	}, [plugin]);

	// 组件卸载兜底：关闭流程未执行时释放当前实例（仅 onUnmount，不调用 onBlur）。
	// 关键：不依赖 [plugin]，否则热更新替换插件实现会误触发清理；
	// 清理本身也通过实例幂等标记去重，不会与 handleClose 重复调用。
	useEffect(() => {
		return () => {
			const instance = instanceRef.current;
			if (!instance) return;
			instanceRef.current = null;
			disposeInstance(instance, false);
		};
	}, []);

	// 同步 renderErrorRef → renderError state
	// 渲染阶段只写 ref（避免渲染期间 setState 反模式），由此 effect 同步到 state 触发重渲染
	useEffect(() => {
		if (renderErrorRef.current !== renderError) {
			setRenderError(renderErrorRef.current);
		}
	});

	const handleClose = useCallback(() => {
		if (closedRef.current) return;
		closedRef.current = true;
		// 关闭前调用 onBlur → onUnmount 生命周期钩子（disposeInstance 内部保证幂等）
		const instance = instanceRef.current;
		if (instance) {
			instanceRef.current = null;
			disposeInstance(instance, true);
		}
		onClose();
	}, [onClose]);

	// 处理输入
	useInput(
		(input: string, key: any) => {
			// 只处理与当前 pluginId 匹配的有效实例，避免切换过渡期串用旧实例
			const instance = getActiveInstance(instanceRef.current, pluginId);
			if (!instance || error) {
				if (key.escape) {
					handleClose();
				}
				return;
			}

			// ESC 始终关闭面板
			if (key.escape) {
				handleClose();
				return;
			}

			// home / end 现由 vendor/ink 的 use-input.ts 解析转义序列后直接填入 key 对象，
			// 无需在此额外监听 stdin raw data。
			const panelInput: AnyPanelInput = {
				input,
				key: {
					upArrow: key.upArrow ?? false,
					downArrow: key.downArrow ?? false,
					leftArrow: key.leftArrow ?? false,
					rightArrow: key.rightArrow ?? false,
					return: key.return ?? false,
					escape: key.escape ?? false,
					backspace: key.backspace ?? false,
					delete: key.delete ?? false,
					ctrl: key.ctrl ?? false,
					shift: key.shift ?? false,
					meta: key.meta ?? false,
					tab: key.tab ?? false,
					pageUp: key.pageUp ?? false,
					pageDown: key.pageDown ?? false,
					home: key.home ?? false,
					end: key.end ?? false,
				},
			};

			try {
				instance.state = instance.plugin.handleInput(
					instance.state,
					panelInput,
				);
				// handleInput 成功后清除渲染错误状态（写 ref，由 useEffect 同步到 state）
				renderErrorRef.current = null;
				// 检查插件是否请求关闭
				const status = instance.plugin.getStatus(instance.state);
				if (status === 'done') {
					handleClose();
					return;
				}
				// 强制重新渲染
				forceRender(n => n + 1);
			} catch (err) {
				// handleInput 出错时不关闭面板，显示错误信息（写 ref，由 useEffect 同步到 state）
				renderErrorRef.current =
					err instanceof Error ? err.message : String(err);
				forceRender(n => n + 1);
			}
		},
		{isActive: true},
	);

	// 错误状态（致命错误：加载失败 / 插件未找到）
	if (error) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.error} bold>
					{t.anyPanel.errorTitle}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.error}>{error}</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>{t.anyPanel.pressEscToClose}</Text>
				</Box>
			</Box>
		);
	}

	// 渲染只使用与当前 pluginId 匹配、已完成初始化的实例；
	// 插件切换过渡期与关闭后不再显示旧插件内容
	const activeInstance = getActiveInstance(instanceRef.current, pluginId);

	// 加载中（含尚未就绪与插件切换过渡）
	if (!activeInstance || !plugin) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.menuInfo}>{t.anyPanel.loading}</Text>
			</Box>
		);
	}

	// 渲染插件画面
	// 优先使用 render()（富文本模式），回退到 getRenderLines()（纯文本模式）
	let pluginContent: React.ReactNode = null;
	let currentRenderError: string | null = null;

	if (typeof plugin.render === 'function') {
		// 富文本模式：注入 React + ink 组件 + 主题色
		const renderCtx: AnyPanelRenderContext = {
			React,
			Box,
			Text,
			Newline,
			Spacer,
			theme,
			language,
			terminalWidth,
			sessionId,
			sessionJson,
			forceRerender: () => forceRender(n => n + 1),
		};
		try {
			pluginContent = plugin.render(activeInstance.state, renderCtx);
		} catch (err) {
			currentRenderError = err instanceof Error ? err.message : String(err);
		}
	} else if (typeof plugin.getRenderLines === 'function') {
		// 纯文本模式（向后兼容）
		try {
			const renderLines = plugin.getRenderLines(activeInstance.state) || [];
			pluginContent = renderLines.map((line, index) => (
				<Text key={index}>{safeText(line)}</Text>
			));
		} catch (err) {
			currentRenderError = err instanceof Error ? err.message : String(err);
		}
	}

	// 渲染错误恢复策略（渲染阶段只写 ref，不调用 setState 避免反模式）：
	//   - 如果本次渲染成功 → 更新缓存的旧画面，清除 ref 中的错误
	//   - 如果本次渲染失败 → 保留上次成功画面，设置 ref 中的错误
	// renderErrorRef 由下方 useEffect 同步到 renderError state
	if (currentRenderError) {
		// 渲染失败——保留上次成功的内容
		pluginContent = lastContentRef.current;
		renderErrorRef.current = currentRenderError;
	} else {
		// 渲染成功——更新缓存，清除错误
		lastContentRef.current = pluginContent;
		renderErrorRef.current = null;
	}

	// 标题
	const title = getLocalizedText(plugin.description, language) || plugin.name;

	// 提示文本
	let hint: string | undefined;
	try {
		hint = plugin.getHint?.(activeInstance.state);
	} catch (error) {
		log.debug('AnyPanel getHint failed', {error});
		hint = undefined;
	}

	return (
		<Box paddingX={1} flexDirection="column">
			{/* 标题栏 */}
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{safeText(title)}
				</Text>
			</Box>

			{/* 插件渲染区域 */}
			<Box flexDirection="column">{pluginContent}</Box>

			{/* 渲染错误提示（非致命：面板继续运行） */}
			{renderError && (
				<Box marginTop={1}>
					<Text color={theme.colors.warning}>
						{t.anyPanel.renderError.replace('{error}', renderError)}
					</Text>
				</Box>
			)}

			{/* 底部提示 */}
			{hint && (
				<Box marginTop={1}>
					<Text dimColor>{safeText(hint)}</Text>
				</Box>
			)}
			{!hint && (
				<Box marginTop={1}>
					<Text dimColor>{t.anyPanel.pressEscToClose}</Text>
				</Box>
			)}
		</Box>
	);
}
