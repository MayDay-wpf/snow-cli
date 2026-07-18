import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../i18n/index.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {navigateTo} from '../../hooks/integration/useGlobalNavigation.js';
import {
	getBuiltinGames,
	loadExternalGamePlugins,
	mergeGamePlugins,
	getLocalizedDescription,
	safeText,
	type GamePlugin,
} from '../../utils/plugins/games/index.js';
import GameRunner from '../components/games/GameRunner.js';

type Props = {
	onBack?: () => void;
	terminalWidth: number;
};

/**
 * 游戏面板页面。
 *
 * 类似 PixelEditorScreen 的结构：
 *   - menu 视图：显示游戏列表，上下选择，Enter 进入
 *   - game 视图：运行选中的游戏，ESC 返回菜单
 */
export default function GamesScreen({onBack, terminalWidth}: Props) {
	const {t, language} = useI18n();
	const ts = t.gamesScreen;
	useTerminalTitle(`Snow CLI - ${ts.screenTitle}`);

	const [view, setView] = useState<'menu' | 'game'>('menu');
	const [games, setGames] = useState<GamePlugin[]>(() => getBuiltinGames());
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [loadingExternal, setLoadingExternal] = useState(true);

	// 懒加载外部插件
	useEffect(() => {
		let disposed = false;
		(async () => {
			try {
				const external = await loadExternalGamePlugins();
				if (!disposed) {
					setGames(mergeGamePlugins(external));
					setLoadingExternal(false);
				}
			} catch {
				if (!disposed) {
					setLoadingExternal(false);
				}
			}
		})();
		return () => {
			disposed = true;
		};
	}, []);

	// 确保 selectedIndex 不越界
	useEffect(() => {
		setSelectedIndex(prev => {
			if (games.length === 0) return 0;
			return Math.min(prev, games.length - 1);
		});
	}, [games.length]);

	// 分页显示
	const maxVisibleItems = 8;
	const displayWindow = useMemo(() => {
		if (games.length <= maxVisibleItems) {
			return {items: games, startIndex: 0, endIndex: games.length};
		}
		let startIndex = 0;
		if (selectedIndex >= maxVisibleItems) {
			startIndex = selectedIndex - maxVisibleItems + 1;
		}
		const endIndex = Math.min(games.length, startIndex + maxVisibleItems);
		return {
			items: games.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [games, selectedIndex]);

	const hiddenAboveCount = displayWindow.startIndex;
	const hiddenBelowCount = Math.max(0, games.length - displayWindow.endIndex);
	const showOverflowHint = games.length > maxVisibleItems;

	const handleExit = useCallback(() => {
		setView('menu');
	}, []);

	useInput((input: string, key: any) => {
		if (view === 'game') {
			// GameRunner 内部处理 ESC，这里不重复处理
			return;
		}

		// menu 视图按键处理
		if (key.escape || input === 'q' || input === 'Q') {
			if (onBack) {
				onBack();
			} else {
				navigateTo('chat');
			}
			return;
		}

		if (loadingExternal || games.length === 0) return;

		if (key.upArrow) {
			setSelectedIndex(prev =>
				prev > 0 ? prev - 1 : Math.max(0, games.length - 1),
			);
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => {
				const maxIndex = Math.max(0, games.length - 1);
				return prev < maxIndex ? prev + 1 : 0;
			});
			return;
		}

		if (key.return) {
			setView('game');
			return;
		}
	});

	// 游戏运行视图
	if (view === 'game') {
		const selectedGame = games[selectedIndex];
		if (selectedGame) {
			return (
				<Box paddingX={1} flexDirection="column">
					<GameRunner
						game={selectedGame}
						terminalWidth={terminalWidth}
						onExit={handleExit}
					/>
				</Box>
			);
		}
	}

	// 菜单视图
	return (
		<Box paddingX={1} flexDirection="column">
			<Text bold color="cyan">
				{ts.screenTitle}
			</Text>

			<Box marginTop={1} flexDirection="column">
				{loadingExternal ? (
					<Text color="gray" dimColor>
						{ts.loading}
					</Text>
				) : games.length === 0 ? (
					<Text color="gray" dimColor>
						{ts.noGames}
					</Text>
				) : (
					displayWindow.items.map((game, index) => {
						const originalIndex = displayWindow.startIndex + index;
						const isSelected = originalIndex === selectedIndex;
						return (
							<Text
								key={game.id}
								color={isSelected ? 'yellow' : 'white'}
								bold={isSelected}
							>
								{isSelected ? '❯ ' : '  '}
								{safeText(game.name)}
								{game.author ? ` (${safeText(game.author)})` : ''}
							</Text>
						);
					})
				)}
			</Box>

			{!loadingExternal && games.length > 0 && (
				<Box marginTop={1}>
					{(() => {
						const desc = getLocalizedDescription(
							games[selectedIndex]?.description,
							language,
						);
						return desc ? (
							<Text color="gray" dimColor>
								{'  '}
								{desc}
							</Text>
						) : null;
					})()}
				</Box>
			)}

			<Box marginTop={1} flexDirection="column">
				<Text color="gray" dimColor>
					{ts.menuHint}
				</Text>
				{showOverflowHint && hiddenAboveCount > 0 && (
					<Text color="gray" dimColor>
						{ts.moreAbove.replace('{count}', String(hiddenAboveCount))}
					</Text>
				)}
				{showOverflowHint && hiddenBelowCount > 0 && (
					<Text color="gray" dimColor>
						{ts.moreBelow.replace('{count}', String(hiddenBelowCount))}
					</Text>
				)}
				<Text color="gray" dimColor>
					{ts.pluginDirHint}
				</Text>
			</Box>
		</Box>
	);
}
