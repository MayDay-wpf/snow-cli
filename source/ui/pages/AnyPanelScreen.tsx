import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Box, Text, Newline, Spacer, useInput} from 'ink';
import {existsSync, watch} from 'node:fs';
import {extname} from 'node:path';
import {useI18n} from '../../i18n/index.js';
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

type Props = {
	/** AnyPanel 插件 id，来自自定义指令的 command 字段 */
	pluginId: string;
	/** 终端宽度 */
	terminalWidth: number;
	/** 关闭面板回调 */
	onClose: () => void;
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
}: Props) {
	const {t, language} = useI18n();
	const {theme} = useTheme();

	const [plugin, setPlugin] = useState<AnyPanelPlugin | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [, forceRender] = useState(0);
	const stateRef = useRef<unknown>(null);
	const closedRef = useRef(false);

	// 上次成功渲染的内容——渲染出错时保留旧画面，不闪退
	const lastContentRef = useRef<React.ReactNode>(null);
	// 当前渲染错误信息——写入 ref（渲染阶段不触发 setState），由 useEffect 同步到 state
	const renderErrorRef = useRef<string | null>(null);
	// 渲染错误信息（非致命：面板继续运行，下次渲染成功后自动清除）
	const [renderError, setRenderError] = useState<string | null>(null);

	// 始终持有最新的 plugin 引用——供 onUnmount 兜底 effect 使用，
	// 避免 effect 依赖 [plugin] 在热重载时误触发 onUnmount（见下方注释）。
	const pluginRef = useRef<AnyPanelPlugin | null>(null);
	pluginRef.current = plugin;

	// 加载插件
	// 每次打开面板都强制 bustCache=true，绕过 ESM 模块缓存，
	// 确保开发期修改的插件代码无需重启 CLI 即可生效。
	useEffect(() => {
		let disposed = false;
		(async () => {
			try {
				const plugins = await loadAnyPanelPlugins(true);
				const indexed = indexAnyPanelPlugins(plugins);
				const found = indexed.get(pluginId);
				if (disposed) return;
				if (!found) {
					setError(t.anyPanel.pluginNotFound.replace('{id}', pluginId));
					setLoading(false);
					return;
				}
				// 初始化插件状态
				const ctx: AnyPanelInitContext = {
					terminalWidth,
					terminalHeight: 40, // 估算值，ink 无法直接获取终端高度
					language,
					cwd: process.cwd(),
				};
				stateRef.current = found.init(ctx);
				setPlugin(found);
				setLoading(false);
				// 调用 onMount 生命周期钩子
				try {
					found.onMount?.(stateRef.current);
				} catch {
					// onMount 出错不影响面板运行
				}
				// 面板挂载即获得焦点
				try {
					found.onFocus?.(stateRef.current);
				} catch {
					// onFocus 出错不影响面板运行
				}
			} catch (err) {
				if (disposed) return;
				setError(
					t.anyPanel.loadError.replace(
						'{error}',
						err instanceof Error ? err.message : String(err),
					),
				);
				setLoading(false);
			}
		})();
		return () => {
			disposed = true;
		};
	}, [pluginId, terminalWidth, language, t.anyPanel]);

	// 热重载：监听插件目录文件变更，自动重新加载插件代码
	// 编辑器保存（可能触发多次事件）后 debounce 300ms 执行一次
	// 热重载时保留 stateRef.current 不重新 init()，仅替换 plugin 引用
	useEffect(() => {
		if (closedRef.current) return;
		if (!existsSync(ANYPANEL_PLUGIN_DIR)) return;

		let timer: ReturnType<typeof setTimeout> | null = null;

		const reloadPlugin = async () => {
			try {
				// bustCache=true 绕过 ESM 模块缓存，拿到最新代码
				const plugins = await loadAnyPanelPlugins(true);
				const indexed = indexAnyPanelPlugins(plugins);
				const found = indexed.get(pluginId);
				if (!found) return; // 插件被删除或暂时不可用，保持现状
				// 保留 stateRef.current，仅热替换插件代码
				setPlugin(found);
				forceRender(n => n + 1);
			} catch {
				// 加载失败时保持现状，不打断用户操作
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

		watcher.on('error', () => {
			// 监听出错时静默忽略，不影响面板正常运行
		});

		return () => {
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
			forceRender(n => n + 1);
		}, interval);
		return () => clearInterval(timer);
	}, [plugin]);

	// 组件卸载时调用 onUnmount 生命周期钩子（兜底）
	// 如果已经通过 handleClose() 调用过则跳过，避免双重调用。
	// 关键：此 effect 不依赖 [plugin]，而是读取 pluginRef.current。
	// 若依赖 [plugin]，热重载（setPlugin）会触发 cleanup → 误调用旧插件 onUnmount，
	// 违背"onUnmount 仅在面板关闭时调用一次"的生命周期契约。
	useEffect(() => {
		return () => {
			if (closedRef.current) return; // handleClose 已调用过 onUnmount
			const currentPlugin = pluginRef.current;
			if (currentPlugin?.onUnmount && stateRef.current !== null) {
				try {
					currentPlugin.onUnmount(stateRef.current);
				} catch {
					// onUnmount 出错不影响后续清理
				}
			}
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
		// 关闭前调用 onBlur → onUnmount 生命周期钩子
		if (plugin && stateRef.current !== null) {
			try {
				plugin.onBlur?.(stateRef.current);
			} catch {
				// 忽略
			}
			try {
				plugin.onUnmount?.(stateRef.current);
			} catch {
				// 忽略
			}
		}
		onClose();
	}, [onClose, plugin]);

	// 处理输入
	useInput(
		(input: string, key: any) => {
			if (!plugin || loading || error) {
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
				stateRef.current = plugin.handleInput(stateRef.current, panelInput);
				// handleInput 成功后清除渲染错误状态（写 ref，由 useEffect 同步到 state）
				renderErrorRef.current = null;
				// 检查插件是否请求关闭
				const status = plugin.getStatus(stateRef.current);
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

	// 加载状态
	if (loading) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.menuInfo}>{t.anyPanel.loading}</Text>
			</Box>
		);
	}

	if (!plugin) {
		return null;
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
			forceRerender: () => forceRender(n => n + 1),
		};
		try {
			pluginContent = plugin.render(stateRef.current, renderCtx);
		} catch (err) {
			currentRenderError = err instanceof Error ? err.message : String(err);
		}
	} else if (typeof plugin.getRenderLines === 'function') {
		// 纯文本模式（向后兼容）
		try {
			const renderLines = plugin.getRenderLines(stateRef.current) || [];
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
		hint = plugin.getHint?.(stateRef.current);
	} catch {
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
