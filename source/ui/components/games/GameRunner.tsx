import React, {useState, useEffect, useRef} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import type {
	GamePlugin,
	GameInput,
	GameInitContext,
} from '../../../utils/plugins/games/index.js';
import {safeText} from '../../../utils/plugins/games/index.js';

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
 *   5. ESC 退出游戏
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

	// 同步 ref 以便 tick 回调能拿到最新状态
	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	// 游戏 tick 循环
	useEffect(() => {
		const interval = 200; // 默认 200ms tick
		tickIntervalRef.current = setInterval(() => {
			const current = stateRef.current;
			const result = game.tick(current);
			if (result !== null) {
				setState(result);
			}
		}, interval);

		return () => {
			if (tickIntervalRef.current) {
				clearInterval(tickIntervalRef.current);
			}
		};
	}, [game]);

	// 按键处理
	useInput((input: string, key: any) => {
		// ESC 退出游戏
		if (key.escape) {
			onExit();
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

	// 渲染游戏——用 safeText 防御插件返回非字符串值（如多语言对象）导致 React 闪退
	const renderLines = (game.render(state) as unknown[]).map(line =>
		safeText(line),
	);
	const status = game.getStatus(state);
	const hint = safeText(game.getHint?.(state));
	const score = game.getScore?.(state) ?? null;

	const statusColor =
		status === 'gameover'
			? 'red'
			: status === 'won'
			? 'green'
			: status === 'paused'
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
					{score !== null && status !== 'playing' && <Text> </Text>}
					{status !== 'playing' && (
						<Text color={statusColor} bold>
							[{status.toUpperCase()}]
						</Text>
					)}
				</Box>
			</Box>

			{/* 游戏画面 */}
			<Box flexDirection="column" marginTop={1}>
				{renderLines.map((line, idx) => (
					<Text key={idx} color={status === 'gameover' ? 'gray' : undefined}>
						{line}
					</Text>
				))}
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
