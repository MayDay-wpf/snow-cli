import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {PixelEditor} from '../components/pixel-editor/index.js';
import {navigateTo} from '../../hooks/integration/useGlobalNavigation.js';
import type {PixelGrid} from '../components/pixel-editor/types.js';
import {homedir} from 'os';
import {join} from 'path';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	statSync,
} from 'fs';

const DRAW_DIR = join(homedir(), '.snow', 'draw');

function ensureDrawDir(): void {
	if (!existsSync(DRAW_DIR)) {
		mkdirSync(DRAW_DIR, {recursive: true});
	}
}

function sanitizeFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
}

interface DrawingFile {
	name: string;
	fileName: string;
	updatedAt: string;
}

type View = 'menu' | 'editor' | 'manager';

type Props = {
	onBack?: () => void;
};

export default function PixelEditorScreen({onBack}: Props) {
	const [view, setView] = useState<View>('menu');
	const [editorReturnView, setEditorReturnView] = useState<View>('menu');
	const [editorKey, setEditorKey] = useState(0);
	const [initialGrid, setInitialGrid] = useState<PixelGrid | undefined>(
		undefined,
	);
	const [editorInitialName, setEditorInitialName] = useState<
		string | undefined
	>(undefined);
	const [drawings, setDrawings] = useState<DrawingFile[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
	const [pendingDelete, setPendingDelete] = useState(false);

	const loadDrawings = useCallback(() => {
		ensureDrawDir();
		try {
			const files = readdirSync(DRAW_DIR)
				.filter(f => f.endsWith('.json'))
				.map(f => {
					const filePath = join(DRAW_DIR, f);
					try {
						const content = readFileSync(filePath, 'utf8');
						const data = JSON.parse(content) as {
							name?: string;
							updatedAt?: string;
						};
						const stat = statSync(filePath);
						return {
							name: data.name ?? f.replace(/\.json$/, ''),
							fileName: f,
							updatedAt: data.updatedAt ?? stat.mtime.toISOString(),
						};
					} catch {
						return null;
					}
				})
				.filter((d): d is DrawingFile => d !== null)
				.sort(
					(a, b) =>
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			setDrawings(files);
		} catch {
			setDrawings([]);
		}
	}, []);

	useEffect(() => {
		if (view === 'manager') {
			loadDrawings();
		}
	}, [view, loadDrawings]);

	useEffect(() => {
		setSelectedIndex(prev => {
			if (drawings.length === 0) return 0;
			return Math.min(prev, drawings.length - 1);
		});
	}, [drawings.length]);

	const handleSave = useCallback((grid: PixelGrid, name: string) => {
		ensureDrawDir();
		const safeName = sanitizeFileName(name);
		const filePath = join(DRAW_DIR, `${safeName}.json`);
		const data = {
			name,
			width: grid[0]?.length ?? 32,
			height: grid.length,
			grid,
			updatedAt: new Date().toISOString(),
		};
		writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
	}, []);

	const handleLoad = useCallback((fileName: string): PixelGrid | undefined => {
		const filePath = join(DRAW_DIR, fileName);
		if (!existsSync(filePath)) return undefined;
		try {
			const content = readFileSync(filePath, 'utf8');
			const data = JSON.parse(content) as {grid?: PixelGrid};
			if (data.grid) {
				return data.grid.map(row => [...row]);
			}
		} catch {
			// ignore
		}
		return undefined;
	}, []);

	const deleteSelected = useCallback(() => {
		for (const name of selectedNames) {
			const filePath = join(DRAW_DIR, name);
			try {
				unlinkSync(filePath);
			} catch {
				// ignore
			}
		}
		setSelectedNames(new Set());
		setPendingDelete(false);
		loadDrawings();
	}, [selectedNames, loadDrawings]);

	const maxVisibleItems = 8;
	const displayWindow = useMemo(() => {
		if (drawings.length <= maxVisibleItems) {
			return {
				items: drawings,
				startIndex: 0,
				endIndex: drawings.length,
			};
		}
		let startIndex = 0;
		if (selectedIndex >= maxVisibleItems) {
			startIndex = selectedIndex - maxVisibleItems + 1;
		}
		const endIndex = Math.min(drawings.length, startIndex + maxVisibleItems);
		return {
			items: drawings.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [drawings, selectedIndex]);

	useInput((input, key) => {
		if (view === 'menu') {
			if (key.escape || input === 'q' || input === 'Q') {
				if (onBack) {
					onBack();
				} else {
					navigateTo('chat');
				}
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev => (prev > 0 ? prev - 1 : 1));
				return;
			}
			if (key.downArrow) {
				setSelectedIndex(prev => (prev < 1 ? prev + 1 : 0));
				return;
			}
			if (key.return) {
				if (selectedIndex === 0) {
					setInitialGrid(undefined);
					setEditorInitialName(undefined);
					setEditorKey(k => k + 1);
					setEditorReturnView('menu');
					setView('editor');
				} else {
					setSelectedIndex(0);
					setSelectedNames(new Set());
					setPendingDelete(false);
					setView('manager');
				}
				return;
			}
			return;
		}

		if (view === 'manager') {
			if (key.escape) {
				if (pendingDelete) {
					setPendingDelete(false);
					return;
				}
				setSelectedNames(new Set());
				setSelectedIndex(0);
				setView('menu');
				return;
			}

			if (pendingDelete) {
				if (
					key.return ||
					input === 'd' ||
					input === 'D' ||
					input === 'y' ||
					input === 'Y'
				) {
					deleteSelected();
					return;
				}
				if (input === 'n' || input === 'N') {
					setPendingDelete(false);
					return;
				}
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, drawings.length - 1),
				);
				return;
			}
			if (key.downArrow) {
				const maxIndex = Math.max(0, drawings.length - 1);
				setSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}
			if (input === ' ') {
				const current = drawings[selectedIndex];
				if (current) {
					setSelectedNames(prev => {
						const next = new Set(prev);
						if (next.has(current.fileName)) {
							next.delete(current.fileName);
						} else {
							next.add(current.fileName);
						}
						return next;
					});
				}
				return;
			}
			if (input === 'd' || input === 'D') {
				if (selectedNames.size > 0) {
					setPendingDelete(true);
				}
				return;
			}
			if (key.return) {
				const current = drawings[selectedIndex];
				if (current) {
					const grid = handleLoad(current.fileName);
					if (grid) {
						setInitialGrid(grid);
						setEditorInitialName(current.name);
						setEditorKey(k => k + 1);
						setEditorReturnView('manager');
						setView('editor');
					}
				}
				return;
			}
			return;
		}
	});

	const hiddenAboveCount = displayWindow.startIndex;
	const hiddenBelowCount = Math.max(
		0,
		drawings.length - displayWindow.endIndex,
	);
	const showOverflowHint = drawings.length > maxVisibleItems;

	if (view === 'editor') {
		return (
			<Box paddingX={1} flexDirection="column">
				<PixelEditor
					key={editorKey}
					initialGrid={initialGrid}
					initialName={editorInitialName}
					onExit={() => {
						setView(editorReturnView);
						setInitialGrid(undefined);
					}}
					onSave={handleSave}
				/>
			</Box>
		);
	}

	if (view === 'manager') {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text bold color="cyan">
					Manage Drawings
				</Text>
				<Box marginTop={1} flexDirection="column">
					{drawings.length === 0 ? (
						<Text color="gray">No drawings found.</Text>
					) : (
						displayWindow.items.map((drawing, index) => {
							const originalIndex = displayWindow.startIndex + index;
							const isSelected = originalIndex === selectedIndex;
							const isChecked = selectedNames.has(drawing.fileName);
							return (
								<Text
									key={drawing.fileName}
									color={isSelected ? 'yellow' : 'white'}
									bold={isSelected}
								>
									{isSelected ? '❯ ' : '  '}
									{isChecked ? '[✓]' : '[ ]'} {drawing.name}
								</Text>
							);
						})
					)}
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" dimColor>
						{pendingDelete
							? `Confirm delete ${selectedNames.size} item(s)? Enter/Y/D confirm, N/Esc cancel`
							: '↑↓ navigate • Space select • D delete • Enter edit • Esc back'}
					</Text>
					{showOverflowHint && hiddenAboveCount > 0 && (
						<Text color="gray" dimColor>
							↑ {hiddenAboveCount} more above
						</Text>
					)}
					{showOverflowHint && hiddenBelowCount > 0 && (
						<Text color="gray" dimColor>
							↓ {hiddenBelowCount} more below
						</Text>
					)}
					{selectedNames.size > 0 && !pendingDelete && (
						<Text color="yellow">
							Selected {selectedNames.size} item
							{selectedNames.size > 1 ? 's' : ''}
						</Text>
					)}
				</Box>
			</Box>
		);
	}

	// menu
	const menuItems = ['New Canvas', 'Manage Drawings'];
	return (
		<Box paddingX={1} flexDirection="column">
			<Text bold color="cyan">
				Pixel Editor
			</Text>
			<Box marginTop={1} flexDirection="column">
				{menuItems.map((item, index) => (
					<Text
						key={item}
						color={selectedIndex === index ? 'yellow' : 'white'}
						bold={selectedIndex === index}
					>
						{selectedIndex === index ? '❯ ' : '  '}
						{item}
					</Text>
				))}
			</Box>
			<Box marginTop={1}>
				<Text color="gray" dimColor>
					↑↓ navigate • Enter select • Esc back
				</Text>
			</Box>
		</Box>
	);
}
