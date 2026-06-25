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

	const handleClose = useCallback(() => {
		if (closedRef.current) return;
		closedRef.current = true;
		onClose();
	}, [onClose]);

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
				},
			};

			try {
				stateRef.current = plugin.handleInput(stateRef.current, panelInput);
				// 检查插件是否请求关闭
				const status = plugin.getStatus(stateRef.current);
				if (status === 'done') {
					handleClose();
					return;
				}
				// 强制重新渲染
				forceRender(n => n + 1);
			} catch (err) {
				setError(
					t.anyPanel.renderError.replace(
						'{error}',
						err instanceof Error ? err.message : String(err),
					),
				);
			}
		},
		{isActive: true},
	);

	// 错误状态
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
	let renderError: string | null = null;

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
			renderError = err instanceof Error ? err.message : String(err);
		}
	} else if (typeof plugin.getRenderLines === 'function') {
		// 纯文本模式（向后兼容）
		try {
			const renderLines = plugin.getRenderLines(stateRef.current) || [];
			pluginContent = renderLines.map((line, index) => (
				<Text key={index}>{safeText(line)}</Text>
			));
		} catch (err) {
			renderError = err instanceof Error ? err.message : String(err);
		}
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

	if (renderError) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.error} bold>
					{t.anyPanel.errorTitle}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.error}>
						{t.anyPanel.renderError.replace('{error}', renderError)}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>{t.anyPanel.pressEscToClose}</Text>
				</Box>
			</Box>
		);
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
