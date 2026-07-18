import React, {useState, useEffect, useRef, useCallback} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import type {
	GamePlugin,
	GameInput,
	GameInitContext,
	GameRenderSegment,
} from '../../../utils/plugins/games/index.js';
import {safeText, DEFAULT_TICK_INTERVAL_MS} from '../../../utils/plugins/games/index.js';

/**
 * 将插件 render() 返回的一行归一化为渲染段落数组。
 *
 * 支持两种行形式（向后兼容）：
 *   - 纯字符串 → 转为单个无样式段落
 *   - GameRenderSegment[] → 逐段校验，text 经 safeText 防御
 *
 * 非字符串/非数组的值（如多语言对象）通过 safeText 降级为字符串段落，
 * 避免 "Objects are not valid as a React child" 闪退。
 */
function normalizeLine(line: unknown): GameRenderSegment[] {
	if (typeof line === 'string') {
		return [{text: line}];
	}
	if (Array.isArray(line)) {
		return line.map(seg => {
			if (typeof seg === 'string') {
				return {text: safeText(seg)};
			}
			if (seg && typeof seg === 'object') {
				return {
					text: safeText((seg as {text?: unknown}).text),
					color:
						typeof (seg as {color?: unknown}).color === 'string'
							? (seg as {color: string}).color
							: undefined,
					bold: (seg as {bold?: unknown}).bold === true,
					dim: (seg as {dim?: unknown}).dim === true,
				};
			}
			return {text: ''};
		});
	}
	// 防御性降级：多语言对象等非字符串值
	return [{text: safeText(line)}];
}

/**
 * 渲染一行：纯字符串行在 gameover 时整体变灰（保持旧行为），
 * 段落数组行则按段独立着色（行内多色，gameover 时由插件控制是否变暗）。
 */
function renderLine(
	line: GameRenderSegment[],
	isGameOver: boolean,
	isPlainString: boolean,
	key?: number,
) {
	return (
		<Box key={key}>
			{line.map((seg, idx) => (
				<Text
					key={idx}
					color={isGameOver && isPlainString ? 'gray' : seg.color}
					bold={seg.bold}
					dimColor={seg.dim || (isGameOver && isPlainString)}
				>
					{seg.text}
				</Text>
			))}
		</Box>
	);
}

interface GameRunnerProps {
	game: GamePlugin;
	terminalWidth: number;
	onExit: () => void;
}

/**
 * 通用游戏运行器组件。
 *
 * 接收一个 GamePlugin 实例，负责：
 *   1. 初始化游戏状态
 *   2. 按 tick interval 调用 plugin.tick() 推进游戏逻辑
 *   3. 通过 useInput 捕获按键并调用 plugin.handleInput()
 *   4. 调用 plugin.render() 渲染游戏画面
 *   5. ESC 退出游戏，p 键暂停/恢复
 */
export default function GameRunner({
	game,
	terminalWidth,
	onExit,
}: GameRunnerProps) {
	const {stdout} = useStdout();
	const terminalHeight = stdout?.rows ?? 24;
	const [state, setState] = useState<unknown>(() => {
		const ctx: GameInitContext = {
			terminalWidth,
			terminalHeight,
		};
		return game.init(ctx);
	});
	const stateRef = useRef(state);
	const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// A3: 引擎级暂停状态——由 GameRunner 统一管理，独立于插件 status
	const [enginePaused, setEnginePaused] = useState(false);
	const enginePausedRef = useRef(false);

	// 同步 ref 以便 tick 回调能拿到最新状态
	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	useEffect(() => {
		enginePausedRef.current = enginePaused;
	}, [enginePaused]);

	// A1: 解析当前 tick 间隔（毫秒）
	// 优先级：getTickInterval(state) > tickInterval > DEFAULT_TICK_INTERVAL_MS
	const resolveInterval = useCallback(
		(s: unknown): number => {
			if (typeof game.getTickInterval === 'function') {
				const v = game.getTickInterval(s);
				if (typeof v === 'number' && v > 0) return v;
			}
			if (typeof game.tickInterval === 'number' && game.tickInterval > 0) {
				return game.tickInterval;
			}
			return DEFAULT_TICK_INTERVAL_MS;
		},
		[game],
	);

	// 游戏 tick 循环
	// 依赖 enginePaused：暂停时清除定时器，恢复时重建
	useEffect(() => {
		// A3: 引擎暂停时不启动 tick 循环
		if (enginePaused) {
			return;
		}

		let currentInterval = resolveInterval(stateRef.current);

		const runTick = () => {
			const current = stateRef.current;
			// A2: 非 playing 状态跳过 tick 调用，避免无意义的 CPU 开销
			if (game.getStatus(current) !== 'playing') {
				return;
			}
			const result = game.tick(current);
			if (result !== null) {
				setState(result);
				// A1: 动态变速——tick 后检查 interval 是否变化，变化则重启定时器
				const newInterval = resolveInterval(result);
				if (newInterval !== currentInterval) {
					currentInterval = newInterval;
					if (tickIntervalRef.current) {
						clearInterval(tickIntervalRef.current);
					}
					tickIntervalRef.current = setInterval(runTick, currentInterval);
				}
			}
		};

		tickIntervalRef.current = setInterval(runTick, currentInterval);

		return () => {
			if (tickIntervalRef.current) {
				clearInterval(tickIntervalRef.current);
				tickIntervalRef.current = null;
			}
		};
	}, [game, enginePaused, resolveInterval]);

	// 按键处理
	useInput((input: string, key: any) => {
		// ESC 退出游戏
		if (key.escape) {
			onExit();
			return;
		}

		// A3: 统一暂停/恢复——按 p 键切换引擎级暂停
		if (input === 'p' || input === 'P') {
			const currentStatus = game.getStatus(stateRef.current);
			// 只在 playing/paused 状态下响应暂停切换，终态（gameover/won）不响应
			if (currentStatus === 'playing' || currentStatus === 'paused') {
				const willPause = !enginePausedRef.current;
				setEnginePaused(willPause);
				if (willPause) {
					game.onPause?.(stateRef.current);
				} else {
					game.onResume?.(stateRef.current);
				}
			}
			return;
		}

		// A3: 暂停时不处理其他游戏输入
		if (enginePausedRef.current) {
			return;
		}

		const gameInput: GameInput = {
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

		setState((prev: unknown) => {
			const newState = game.handleInput(prev, gameInput);
			return newState;
		});
	});

	// 渲染游戏——支持纯字符串行（向后兼容）和带样式段落数组行（行内多色）
	// 非字符串/非数组的值通过 normalizeLine → safeText 防御性降级，避免 React 闪退
	const renderLines = game.render(state) as unknown[];
	const pluginStatus = game.getStatus(state);
	// A3: 引擎暂停时显示 paused 状态，优先于插件自身状态
	const displayStatus = enginePaused ? 'paused' : pluginStatus;
	const isGameOver = displayStatus === 'gameover';
	const hint = enginePaused
		? 'Paused. Press p to resume, ESC to exit.'
		: safeText(game.getHint?.(state));
	const score = game.getScore?.(state) ?? null;

	const statusColor =
		displayStatus === 'gameover'
			? 'red'
			: displayStatus === 'won'
			? 'green'
			: displayStatus === 'paused'
			? 'yellow'
			: 'cyan';

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* 标题行 */}
			<Box justifyContent="space-between">
				<Text bold color="cyan">
					{safeText(game.name)}
				</Text>
				<Box>
					{score !== null && (
						<Text color="yellow" bold>
							{safeText(score)}
						</Text>
					)}
					{score !== null && displayStatus !== 'playing' && <Text> </Text>}
					{displayStatus !== 'playing' && (
						<Text color={statusColor} bold>
							[{displayStatus.toUpperCase()}]
						</Text>
					)}
				</Box>
			</Box>

			{/* 游戏画面 */}
			<Box flexDirection="column" marginTop={1}>
				{renderLines.map((line, idx) =>
					renderLine(
						normalizeLine(line),
						isGameOver,
						typeof line === 'string',
						idx,
					),
				)}
			</Box>

			{/* 提示行 */}
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					{hint}
				</Text>
			</Box>
		</Box>
	);
}
