import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {PixelEditor} from '../components/pixel-editor/index.js';
import {useI18n} from '../../i18n/index.js';
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
const EXIT_IMAGE_PATH = join(homedir(), '.snow', 'exit-image.json');

function ensureDrawDir(): void {
	if (!existsSync(DRAW_DIR)) {
		mkdirSync(DRAW_DIR, {recursive: true});
	}
}

function sanitizeFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
}

function cropGrid(grid: PixelGrid): PixelGrid {
	if (!grid || grid.length === 0) return [];
	const height = grid.length;
	const width = grid[0]?.length ?? 0;
	let minY = height;
	let maxY = -1;
	let minX = width;
	let maxX = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (grid[y]![x] !== '#000000') {
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
			}
		}
	}
	if (maxY < 0) return [];
	return grid.slice(minY, maxY + 1).map(row => row.slice(minX, maxX + 1));
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
	const {t} = useI18n();
	const ts = t.pixelEditorScreen;
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
	const [message, setMessage] = useState<string | null>(null);
	const [exitImageName, setExitImageName] = useState<string | undefined>(
		undefined,
	);
	const [exitImageEnabled, setExitImageEnabled] = useState(false);

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
			if (existsSync(EXIT_IMAGE_PATH)) {
				try {
					const content = readFileSync(EXIT_IMAGE_PATH, 'utf8');
					const data = JSON.parse(content) as {
						name?: string;
						enabled?: boolean;
					};
					setExitImageName(data.name);
					setExitImageEnabled(data.enabled ?? true);
				} catch {
					setExitImageName(undefined);
					setExitImageEnabled(false);
				}
			} else {
				setExitImageName(undefined);
				setExitImageEnabled(false);
			}
		}
	}, [view, loadDrawings]);

	useEffect(() => {
		setSelectedIndex(prev => {
			if (drawings.length === 0) return 0;
			return Math.min(prev, drawings.length - 1);
		});
	}, [drawings.length]);

	useEffect(() => {
		if (!message) return;
		const id = setTimeout(() => setMessage(null), 1500);
		return () => clearTimeout(id);
	}, [message]);

	const handleSave = useCallback(
		(grid: PixelGrid, name: string) => {
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

			if (exitImageEnabled && exitImageName === name) {
				try {
					const cropped = cropGrid(grid);
					const exitData = {
						name,
						width: cropped[0]?.length ?? 0,
						height: cropped.length,
						grid: cropped,
						enabled: true,
						updatedAt: new Date().toISOString(),
					};
					writeFileSync(
						EXIT_IMAGE_PATH,
						JSON.stringify(exitData, null, 2),
						'utf8',
					);
				} catch {
					// ignore sync errors
				}
			}
		},
		[exitImageEnabled, exitImageName],
	);

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
			if (input === 's' || input === 'S') {
				const current = drawings[selectedIndex];
				if (current) {
					if (exitImageEnabled && exitImageName === current.name) {
						try {
							writeFileSync(
								EXIT_IMAGE_PATH,
								JSON.stringify({enabled: false}, null, 2),
								'utf8',
							);
							setExitImageEnabled(false);
							setExitImageName(undefined);
							setMessage(ts.exitImageDisabled);
						} catch {
							setMessage(ts.failedDisableExitImage);
						}
					} else {
						const grid = handleLoad(current.fileName);
						if (grid) {
							const cropped = cropGrid(grid);
							const data = {
								name: current.name,
								width: cropped[0]?.length ?? 0,
								height: cropped.length,
								grid: cropped,
								enabled: true,
								updatedAt: new Date().toISOString(),
							};
							writeFileSync(
								EXIT_IMAGE_PATH,
								JSON.stringify(data, null, 2),
								'utf8',
							);
							setExitImageName(current.name);
							setExitImageEnabled(true);
							setMessage(
								ts.setAsExitImage.replace('{name}', current.name),
							);
						}
					}
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
					{ts.manageTitle}
				</Text>
				<Box marginTop={1} flexDirection="column">
					{drawings.length === 0 ? (
						<Text color="gray">{ts.noDrawings}</Text>
					) : (
						displayWindow.items.map((drawing, index) => {
							const originalIndex = displayWindow.startIndex + index;
							const isSelected = originalIndex === selectedIndex;
							const isChecked = selectedNames.has(drawing.fileName);
							const isExitImage =
								exitImageEnabled && exitImageName === drawing.name;
							return (
								<Text
									key={drawing.fileName}
									color={isSelected ? 'yellow' : 'white'}
									bold={isSelected}
								>
									{isSelected ? '❯ ' : '  '}
									{isChecked ? '[✓]' : '[ ]'} {drawing.name}
									{isExitImage ? ' ★' : ''}
								</Text>
							);
						})
					)}
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text color="yellow" dimColor>
						{pendingDelete
							? ts.confirmDeleteMany.replace(
									'{count}',
									String(selectedNames.size),
							  )
							: ts.managerHint}
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
					{selectedNames.size > 0 && !pendingDelete && (
						<Text color="yellow">
							{ts.selectedCount.replace(
								'{count}',
								String(selectedNames.size),
							)}
						</Text>
					)}
					{message && <Text color="green">{message}</Text>}
				</Box>
			</Box>
		);
	}

	// menu
	const menuItems = [ts.newCanvas, ts.manageDrawings];
	return (
		<Box paddingX={1} flexDirection="column">
			<Text bold color="cyan">
				{ts.screenTitle}
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
					{ts.menuNavigateHint}
				</Text>
			</Box>
		</Box>
	);
}
