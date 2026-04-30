import React, {
	useState,
	useEffect,
	useMemo,
	useCallback,
	forwardRef,
	useImperativeHandle,
	memo,
} from 'react';
import {Box, Text} from 'ink';
import fs from 'fs';
import path from 'path';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {getWorkingDirectories} from '../../../utils/config/workingDirConfig.js';
import {SSHClient, parseSSHUrl} from '../../../utils/ssh/sshClient.js';
import {
	getFileListDisplayMode,
	setFileListDisplayMode,
} from '../../../utils/config/projectSettings.js';

type FileItem = {
	name: string;
	path: string;
	isDirectory: boolean;
	// For content search mode
	lineNumber?: number;
	lineContent?: string;
	// Source working directory for multi-dir support
	sourceDir?: string;
};

type Props = {
	query: string;
	selectedIndex: number;
	visible: boolean;
	maxItems?: number;
	rootPath?: string;
	onFilteredCountChange?: (count: number) => void;
	searchMode?: 'file' | 'content';
};
export type FileListRef = {
	getSelectedFile: () => string | null;
	toggleDisplayMode: () => boolean;
	// Manually expand the BFS scan depth (used when the user navigates past
	// the last filtered result and may want results from deeper directories).
	// Returns true if a deeper scan was actually scheduled.
	triggerDeeperSearch: () => boolean;
};

type DisplayMode = 'list' | 'tree';

type DisplayItem = {
	file: FileItem;
	key: string;
	label: string;
	depth: number;
	isContextOnly?: boolean;
};

// How long the in-memory file index is kept after the panel is hidden.
// When the panel stays closed beyond this window, the cached `files` array
// is released so a long-running CLI session does not hold onto thousands of
// FileItem entries indefinitely. Reopening the panel triggers a fresh scan.
const SEARCH_RESULT_TTL_MS = 30_000;

const getDisplayItemKey = (file: FileItem) =>
	`${file.sourceDir || ''}::${file.path}::${file.lineNumber ?? 0}`;

const getNormalizedItemPath = (itemPath: string) =>
	itemPath.replace(/\\/g, '/').replace(/\/$/, '');

const getLookupKey = (sourceDir: string | undefined, itemPath: string) =>
	`${sourceDir || ''}::${getNormalizedItemPath(itemPath)}`;

const getRelativeTreePath = (file: FileItem) => {
	if (file.path.startsWith('ssh://') || path.isAbsolute(file.path)) {
		return '';
	}

	return getNormalizedItemPath(file.path)
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
};

const getTreeDepth = (file: FileItem) => {
	const relativePath = getRelativeTreePath(file);
	if (!relativePath) {
		return 0;
	}

	return relativePath.split('/').filter(Boolean).length;
};

const compareTreeItems = (a: FileItem, b: FileItem) => {
	const sourceCompare = (a.sourceDir || '').localeCompare(b.sourceDir || '');
	if (sourceCompare !== 0) {
		return sourceCompare;
	}

	const aIsRoot = a.path === (a.sourceDir || '');
	const bIsRoot = b.path === (b.sourceDir || '');
	if (aIsRoot !== bIsRoot) {
		return aIsRoot ? -1 : 1;
	}

	const aParts = getRelativeTreePath(a).split('/').filter(Boolean);
	const bParts = getRelativeTreePath(b).split('/').filter(Boolean);
	const maxDepth = Math.min(aParts.length, bParts.length);

	for (let i = 0; i < maxDepth; i++) {
		const aPart = aParts[i] || '';
		const bPart = bParts[i] || '';
		const diff = aPart.localeCompare(bPart);
		if (diff !== 0) {
			return diff;
		}
	}

	if (aParts.length !== bParts.length) {
		return aParts.length - bParts.length;
	}

	if (a.isDirectory !== b.isDirectory) {
		return a.isDirectory ? -1 : 1;
	}

	return a.name.localeCompare(b.name);
};

const buildTreeDisplayItems = (
	filteredFiles: FileItem[],
	allFiles: FileItem[],
	query: string,
): DisplayItem[] => {
	const allFilesLookup = new Map(
		allFiles.map(file => [getLookupKey(file.sourceDir, file.path), file]),
	);
	const directMatchKeys = new Set(filteredFiles.map(getDisplayItemKey));
	const includedFiles = new Map<
		string,
		{file: FileItem; isContextOnly: boolean}
	>();

	const includeFile = (file: FileItem, isContextOnly: boolean) => {
		const key = getDisplayItemKey(file);
		const existing = includedFiles.get(key);
		if (!existing || (!isContextOnly && existing.isContextOnly)) {
			includedFiles.set(key, {file, isContextOnly});
		}
	};

	filteredFiles.forEach(file => includeFile(file, false));

	if (query.trim()) {
		for (const file of filteredFiles) {
			if (!file.sourceDir) {
				continue;
			}

			const rootFile = allFilesLookup.get(
				getLookupKey(file.sourceDir, file.sourceDir),
			);
			if (rootFile) {
				includeFile(
					rootFile,
					!directMatchKeys.has(getDisplayItemKey(rootFile)),
				);
			}

			const relativePath = getRelativeTreePath(file);
			if (!relativePath) {
				continue;
			}

			const segments = relativePath.split('/').filter(Boolean);
			for (let depth = 1; depth < segments.length; depth++) {
				const ancestorPath = `./${segments.slice(0, depth).join('/')}`;
				const ancestor = allFilesLookup.get(
					getLookupKey(file.sourceDir, ancestorPath),
				);
				if (ancestor) {
					includeFile(
						ancestor,
						!directMatchKeys.has(getDisplayItemKey(ancestor)),
					);
				}
			}
		}
	}

	return Array.from(includedFiles.values())
		.map(({file, isContextOnly}) => ({
			file,
			key: getDisplayItemKey(file),
			label: file.name,
			depth: getTreeDepth(file),
			isContextOnly,
		}))
		.sort((a, b) => compareTreeItems(a.file, b.file));
};

const getFullFilePath = (file: FileItem, rootPath: string) => {
	const baseDir = file.sourceDir || rootPath;

	if (file.path.startsWith('ssh://') || path.isAbsolute(file.path)) {
		return file.path;
	}

	if (baseDir.startsWith('ssh://')) {
		const cleanBase = baseDir.replace(/\/$/, '');
		const cleanRelative = file.path.replace(/^\.\//, '').replace(/^\//, '');
		return `${cleanBase}/${cleanRelative}`;
	}

	return path.join(baseDir, file.path);
};

const FileList = memo(
	forwardRef<FileListRef, Props>(
		(
			{
				query,
				selectedIndex,
				visible,
				maxItems = 10,
				rootPath = process.cwd(),
				onFilteredCountChange,
				searchMode = 'file',
			},
			ref,
		) => {
			const {t} = useI18n();
			const {theme} = useTheme();
			const [files, setFiles] = useState<FileItem[]>([]);
			const [isLoading, setIsLoading] = useState(false);
			// Progressive depth search: start shallow, expand on demand.
			const [searchDepth, setSearchDepth] = useState(2);
			const [hasMoreDepth, setHasMoreDepth] = useState(true);
			const [isIncreasingDepth, setIsIncreasingDepth] = useState(false);
			const [displayMode, setDisplayMode] = useState<DisplayMode>(
				getFileListDisplayMode,
			);

			// Get terminal size for dynamic content display
			const {columns: terminalWidth} = useTerminalSize();

			// Fixed maximum display items to prevent rendering issues
			const MAX_DISPLAY_ITEMS = 5;
			const effectiveMaxItems = useMemo(() => {
				return maxItems
					? Math.min(maxItems, MAX_DISPLAY_ITEMS)
					: MAX_DISPLAY_ITEMS;
			}, [maxItems]);

			// Streamed file loader: walks the tree (BFS) up to `searchDepth` and
			// pushes incremental updates to `files` so the input box can filter
			// against partial results in real time. No file count cap.
			const loadFiles = useCallback(async () => {
				const workingDirs = await getWorkingDirectories();
				const collected: FileItem[] = [];
				// Tracks whether we encountered subdirectories that were skipped
				// because they exceeded `searchDepth`, signalling more depth is available.
				let depthLimitHit = false;

				// Throttle UI updates: flush at most every FLUSH_INTERVAL_MS or every
				// FLUSH_BATCH_SIZE new files, whichever comes first.
				const FLUSH_INTERVAL_MS = 80;
				const FLUSH_BATCH_SIZE = 200;
				let lastFlushAt = 0;
				let pendingSinceFlush = 0;

				const flush = (force: boolean) => {
					const now = Date.now();
					if (
						!force &&
						pendingSinceFlush < FLUSH_BATCH_SIZE &&
						now - lastFlushAt < FLUSH_INTERVAL_MS
					) {
						return;
					}
					lastFlushAt = now;
					pendingSinceFlush = 0;
					setFiles(collected.slice());
				};

				const pushFile = (item: FileItem) => {
					collected.push(item);
					pendingSinceFlush++;
					flush(false);
				};

				// Yield to the event loop so UI/keystrokes stay responsive during long scans.
				const yieldToEventLoop = () =>
					new Promise<void>(resolve => setImmediate(resolve));

				setIsLoading(true);
				setFiles([]);

				for (const workingDir of workingDirs) {
					const dirPath = workingDir.path;

					// Handle remote SSH directories
					if (workingDir.isRemote && workingDir.sshConfig) {
						try {
							const sshInfo = parseSSHUrl(dirPath);
							if (!sshInfo) {
								continue;
							}

							const remoteDirName =
								sshInfo.path.split('/').pop() || sshInfo.host;
							pushFile({
								name: remoteDirName,
								path: dirPath,
								isDirectory: true,
								sourceDir: dirPath,
							});

							const sshClient = new SSHClient();
							const connectResult = await sshClient.connect(
								workingDir.sshConfig,
								workingDir.sshConfig.password,
							);

							if (!connectResult.success) {
								continue;
							}

							// BFS over remote directories so siblings are sampled fairly.
							const queue: Array<{path: string; depth: number}> = [
								{path: sshInfo.path, depth: 0},
							];
							while (queue.length > 0) {
								const node = queue.shift() as {path: string; depth: number};
								const current = node.path;
								let entries: Awaited<
									ReturnType<typeof sshClient.listDirectory>
								> = [];
								try {
									entries = await sshClient.listDirectory(current);
								} catch {
									continue;
								}

								for (const entry of entries) {
									if (entry.name.startsWith('.') && entry.name !== '.snow') {
										continue;
									}

									const fullRemotePath = current + '/' + entry.name;
									let relativePath = fullRemotePath.substring(
										sshInfo.path.length,
									);
									if (!relativePath.startsWith('/')) {
										relativePath = '/' + relativePath;
									}
									relativePath = '.' + relativePath;

									pushFile({
										name: entry.name,
										path: relativePath,
										isDirectory: entry.isDirectory,
										sourceDir: dirPath,
									});

									if (entry.isDirectory) {
										if (node.depth < searchDepth) {
											queue.push({path: fullRemotePath, depth: node.depth + 1});
										} else {
											depthLimitHit = true;
										}
									}
								}

								await yieldToEventLoop();
							}

							sshClient.disconnect();
						} catch {
							// SSH connection failed, skip this directory
						}

						continue;
					}

					// Handle local directories
					const localDirName = path.basename(dirPath) || dirPath;
					pushFile({
						name: localDirName,
						path: dirPath,
						isDirectory: true,
						sourceDir: dirPath,
					});

					// Read .gitignore patterns for this directory (only ignore source)
					const gitignorePath = path.join(dirPath, '.gitignore');
					let gitignorePatterns: string[] = [];
					try {
						const content = await fs.promises.readFile(gitignorePath, 'utf-8');
						gitignorePatterns = content
							.split('\n')
							.map(line => line.trim())
							.filter(line => line && !line.startsWith('#'))
							.map(line => line.replace(/\/$/, ''));
					} catch {
						// No .gitignore or read error
					}

					// BFS so the first results come from shallow, broadly useful directories.
					const queue: Array<{path: string; depth: number}> = [
						{path: dirPath, depth: 0},
					];
					while (queue.length > 0) {
						const node = queue.shift() as {path: string; depth: number};
						const current = node.path;
						let entries: import('fs').Dirent[] = [];
						try {
							entries = await fs.promises.readdir(current, {
								withFileTypes: true,
							});
						} catch {
							continue;
						}

						for (const entry of entries) {
							if (
								(entry.name.startsWith('.') && entry.name !== '.snow') ||
								gitignorePatterns.includes(entry.name)
							) {
								continue;
							}

							const fullPath = path.join(current, entry.name);

							// Skip files larger than 10MB to keep memory usage bounded
							try {
								const stats = await fs.promises.stat(fullPath);
								if (!entry.isDirectory() && stats.size > 10 * 1024 * 1024) {
									continue;
								}
							} catch {
								continue;
							}

							let relativePath = path
								.relative(dirPath, fullPath)
								.replace(/\\/g, '/');
							if (
								!relativePath.startsWith('.') &&
								!path.isAbsolute(relativePath)
							) {
								relativePath = './' + relativePath;
							}

							pushFile({
								name: entry.name,
								path: relativePath,
								isDirectory: entry.isDirectory(),
								sourceDir: dirPath,
							});

							if (entry.isDirectory()) {
								if (node.depth < searchDepth) {
									queue.push({path: fullPath, depth: node.depth + 1});
								} else {
									depthLimitHit = true;
								}
							}
						}

						// Cooperative yield: let React render and the user keep typing.
						await yieldToEventLoop();
					}
				}

				flush(true);
				setHasMoreDepth(depthLimitHit);
				setIsLoading(false);
			}, [searchDepth]);

			// Search file content for content search mode
			const searchFileContent = useCallback(
				async (query: string): Promise<FileItem[]> => {
					if (!query.trim()) {
						return [];
					}

					const results: FileItem[] = [];
					const queryLower = query.toLowerCase();
					const maxResults = 100; // Limit results for performance

					// Search all non-directory files; binary/encoding errors are caught
					// in the readFile try/catch below, and >10MB files are already skipped
					// during directory scan.
					const filesToSearch = files.filter(f => !f.isDirectory);

					// Process files in batches to avoid blocking
					const batchSize = 10;

					for (
						let batchStart = 0;
						batchStart < filesToSearch.length;
						batchStart += batchSize
					) {
						if (results.length >= maxResults) {
							break;
						}

						const batch = filesToSearch.slice(
							batchStart,
							batchStart + batchSize,
						);

						// Process batch files concurrently but with limit
						const batchPromises = batch.map(async file => {
							const fileResults: FileItem[] = [];

							try {
								// Use sourceDir if available, otherwise fallback to rootPath
								const baseDir = file.sourceDir || rootPath;
								const fullPath = path.join(baseDir, file.path);
								const content = await fs.promises.readFile(fullPath, 'utf-8');
								const lines = content.split('\n');

								// Search each line for the query
								for (let i = 0; i < lines.length; i++) {
									if (fileResults.length >= 10) {
										// Max 10 results per file
										break;
									}

									const line = lines[i];
									if (line && line.toLowerCase().includes(queryLower)) {
										const maxLineLength = Math.max(40, terminalWidth - 10);

										fileResults.push({
											name: file.name,
											path: file.path,
											isDirectory: false,
											lineNumber: i + 1,
											lineContent: line.trim().slice(0, maxLineLength),
											sourceDir: file.sourceDir, // Preserve source directory
										});
									}
								}
							} catch (error) {
								// Skip files that can't be read (binary or encoding issues)
							}

							return fileResults;
						});

						// Wait for batch to complete
						const batchResults = await Promise.all(batchPromises);

						// Flatten and add to results
						for (const fileResults of batchResults) {
							if (results.length >= maxResults) {
								break;
							}
							results.push(
								...fileResults.slice(0, maxResults - results.length),
							);
						}
					}

					return results;
				},
				[files, rootPath, terminalWidth],
			);

			// Load files when component becomes visible
			// This ensures the file list is always fresh without complex file watching
			useEffect(() => {
				if (!visible) {
					return;
				}

				// Always reload when becoming visible to ensure fresh data
				loadFiles();
			}, [visible, rootPath, loadFiles]);

			// State for filtered files (needed for async content search)
			const [allFilteredFiles, setAllFilteredFiles] = useState<FileItem[]>([]);

			// Release cached results after the panel has been hidden for
			// SEARCH_RESULT_TTL_MS. Toggling visible cancels the pending timer so
			// quick close/reopen reuses the cache; only a sustained close evicts it.
			useEffect(() => {
				if (visible) {
					return;
				}

				const timer = setTimeout(() => {
					setFiles([]);
					setAllFilteredFiles([]);
					// Reset depth state so the next open starts shallow again.
					setSearchDepth(2);
					setHasMoreDepth(true);
				}, SEARCH_RESULT_TTL_MS);

				return () => clearTimeout(timer);
			}, [visible]);

			// Filter files based on query and search mode with debounce
			useEffect(() => {
				const performSearch = async () => {
					if (!query.trim()) {
						setAllFilteredFiles(files);
						return;
					}

					if (searchMode === 'content') {
						// Content search mode (@@)
						const results = await searchFileContent(query);
						setAllFilteredFiles(results);
					} else {
						// File name search mode (@)
						const queryLower = query.toLowerCase().replace(/\\/g, '/');
						const filtered = files.filter(file => {
							const fileName = file.name.toLowerCase();
							const filePath = file.path.toLowerCase().replace(/\\/g, '/');
							// Also search in sourceDir for working directory entries
							const sourceDir = (file.sourceDir || '')
								.toLowerCase()
								.replace(/\\/g, '/');
							const searchableFullPath = (() => {
								if (
									file.path.startsWith('ssh://') ||
									path.isAbsolute(file.path)
								) {
									return filePath;
								}
								if ((file.sourceDir || '').startsWith('ssh://')) {
									const cleanBase = (file.sourceDir || '')
										.toLowerCase()
										.replace(/\/$/, '');
									const cleanRelative = filePath
										.replace(/^\.\//, '')
										.replace(/^\//, '');
									return `${cleanBase}/${cleanRelative}`;
								}
								if (file.sourceDir) {
									return path
										.join(file.sourceDir, file.path)
										.toLowerCase()
										.replace(/\\/g, '/');
								}
								return filePath;
							})();
							return (
								fileName.includes(queryLower) ||
								filePath.includes(queryLower) ||
								sourceDir.includes(queryLower) ||
								searchableFullPath.includes(queryLower)
							);
						});

						// Sort by relevance (exact name matches first, then path matches)
						filtered.sort((a, b) => {
							const aNameMatch = a.name.toLowerCase().startsWith(queryLower);
							const bNameMatch = b.name.toLowerCase().startsWith(queryLower);

							if (aNameMatch && !bNameMatch) return -1;
							if (!aNameMatch && bNameMatch) return 1;

							return a.name.localeCompare(b.name);
						});

						setAllFilteredFiles(filtered);

						// Progressive depth: when the user has typed something but no
						// match is found in the currently loaded set, expand the scan
						// depth so a follow-up scan can pick up files deeper in the tree.
						// Only trigger when not already scanning, otherwise we would
						// thrash setSearchDepth while the previous scan is in flight.
						if (
							!isLoading &&
							filtered.length === 0 &&
							query.trim().length > 0 &&
							hasMoreDepth
						) {
							setSearchDepth(d => d + 3);
							setIsIncreasingDepth(true);
							setTimeout(() => setIsIncreasingDepth(false), 400);
						}
					}
				};

				// Debounce search to avoid excessive updates during fast typing
				// Use shorter delay for file search (150ms) and longer for content search (500ms)
				const debounceDelay = searchMode === 'content' ? 500 : 150;
				const timer = setTimeout(() => {
					performSearch();
				}, debounceDelay);

				return () => clearTimeout(timer);
			}, [
				files,
				query,
				searchMode,
				searchFileContent,
				isLoading,
				hasMoreDepth,
			]);

			const displayItems = useMemo<DisplayItem[]>(() => {
				if (searchMode === 'content') {
					return allFilteredFiles.map(file => ({
						file,
						key: getDisplayItemKey(file),
						label:
							file.lineNumber !== undefined
								? `${file.path}:${file.lineNumber}`
								: file.path,
						depth: 0,
					}));
				}

				if (displayMode === 'tree') {
					return buildTreeDisplayItems(allFilteredFiles, files, query);
				}

				return allFilteredFiles.map(file => ({
					file,
					key: getDisplayItemKey(file),
					label: file.path,
					depth: 0,
				}));
			}, [allFilteredFiles, files, displayMode, searchMode, query]);

			const normalizedSelectedIndex = useMemo(() => {
				if (displayItems.length === 0) {
					return 0;
				}

				return Math.min(selectedIndex, displayItems.length - 1);
			}, [displayItems.length, selectedIndex]);

			const fileWindow = useMemo(() => {
				if (displayItems.length <= effectiveMaxItems) {
					return {
						items: displayItems,
						startIndex: 0,
						endIndex: displayItems.length,
					};
				}

				const halfWindow = Math.floor(effectiveMaxItems / 2);
				let startIndex = Math.max(0, normalizedSelectedIndex - halfWindow);
				let endIndex = Math.min(
					displayItems.length,
					startIndex + effectiveMaxItems,
				);

				if (endIndex - startIndex < effectiveMaxItems) {
					startIndex = Math.max(0, endIndex - effectiveMaxItems);
				}

				return {
					items: displayItems.slice(startIndex, endIndex),
					startIndex,
					endIndex,
				};
			}, [displayItems, normalizedSelectedIndex, effectiveMaxItems]);

			const filteredFiles = fileWindow.items;
			const hiddenAboveCount = fileWindow.startIndex;
			const hiddenBelowCount = Math.max(
				0,
				displayItems.length - fileWindow.endIndex,
			);

			useEffect(() => {
				if (onFilteredCountChange) {
					onFilteredCountChange(displayItems.length);
				}
			}, [displayItems.length, onFilteredCountChange]);

			useImperativeHandle(
				ref,
				() => ({
					getSelectedFile: () => {
						const selectedEntry = displayItems[normalizedSelectedIndex];
						if (!selectedEntry) {
							return null;
						}

						const fullPath = getFullFilePath(selectedEntry.file, rootPath);

						if (selectedEntry.file.isDirectory && searchMode === 'file') {
							const normalizedDirectoryPath = fullPath.replace(/\\/g, '/');
							return normalizedDirectoryPath.endsWith('/')
								? normalizedDirectoryPath
								: `${normalizedDirectoryPath}/`;
						}

						if (selectedEntry.file.lineNumber !== undefined) {
							return `${fullPath}:${selectedEntry.file.lineNumber}`;
						}

						return fullPath;
					},
					toggleDisplayMode: () => {
						if (searchMode !== 'file') {
							return false;
						}

						const newMode = displayMode === 'list' ? 'tree' : 'list';
						setDisplayMode(newMode);
						setFileListDisplayMode(newMode);
						return true;
					},
					triggerDeeperSearch: () => {
						// Only meaningful for the file-name picker; content search reads
						// from the already-loaded file index.
						if (searchMode !== 'file') {
							return false;
						}
						// No deeper directories left to scan, or a scan is already
						// in flight — nothing to do.
						if (!hasMoreDepth || isLoading || isIncreasingDepth) {
							return false;
						}

						setSearchDepth(d => d + 3);
						setIsIncreasingDepth(true);
						setTimeout(() => setIsIncreasingDepth(false), 400);
						return true;
					},
				}),
				[
					displayItems,
					normalizedSelectedIndex,
					rootPath,
					searchMode,
					hasMoreDepth,
					isLoading,
					isIncreasingDepth,
				],
			);

			const displaySelectedIndex =
				filteredFiles.length === 0
					? -1
					: normalizedSelectedIndex - fileWindow.startIndex;

			const selectedFileFullPath = useMemo(() => {
				const selectedEntry = displayItems[normalizedSelectedIndex];
				if (!selectedEntry) {
					return null;
				}

				return getFullFilePath(selectedEntry.file, rootPath);
			}, [displayItems, normalizedSelectedIndex, rootPath]);

			if (!visible) {
				return null;
			}

			// Treat "still searching" broadly: either a scan is in flight, or a
			// deeper rescan was just queued (isIncreasingDepth), or there are still
			// untouched deeper directories that the next query miss can expand into.
			// This prevents a brief "No files found" flash between depth bumps when
			// the new loadFiles call is still awaiting its first async tick.
			const stillSearching =
				isLoading ||
				isIncreasingDepth ||
				(query.trim().length > 0 && hasMoreDepth);

			if (stillSearching && displayItems.length === 0) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color="blue" dimColor>
							{isIncreasingDepth || (query.trim().length > 0 && hasMoreDepth)
								? t.fileList.searchingDeeper.replace(
										'{depth}',
										searchDepth.toString(),
								  )
								: t.fileList.loadingFiles}
						</Text>
					</Box>
				);
			}

			if (displayItems.length === 0) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.fileList.noFilesFound}
						</Text>
					</Box>
				);
			}

			return (
				<Box paddingX={1} marginTop={1} flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.menuInfo} bold>
							{searchMode === 'content'
								? t.fileList.contentSearchHeader
								: t.fileList.filesHeader.replace(
										'{mode}',
										displayMode === 'tree'
											? t.fileList.treeMode
											: t.fileList.listMode,
								  )}{' '}
							{displayItems.length > effectiveMaxItems &&
								`(${normalizedSelectedIndex + 1}/${displayItems.length})`}
						</Text>
					</Box>
					{filteredFiles.map((item, index) => {
						const file = item.file;
						const isSelected = index === displaySelectedIndex;
						const isTreeMode = searchMode === 'file' && displayMode === 'tree';
						const prefix =
							searchMode === 'content'
								? ''
								: isTreeMode
								? `${'  '.repeat(item.depth)}${
										item.isContextOnly ? '· ' : file.isDirectory ? '▽ ' : '• '
								  }`
								: file.isDirectory
								? '◇ '
								: '◆ ';
						const color = isSelected
							? theme.colors.menuNormal
							: item.isContextOnly
							? theme.colors.menuSecondary
							: file.isDirectory
							? theme.colors.warning
							: 'white';

						return (
							<Box key={item.key} flexDirection="column">
								<Text
									backgroundColor={
										isSelected ? theme.colors.menuSelected : undefined
									}
									color={color}
									dimColor={Boolean(item.isContextOnly && !isSelected)}
								>
									{isSelected ? '❯ ' : '  '}
									{searchMode === 'content'
										? item.label
										: `${prefix}${item.label}`}
								</Text>
								{searchMode === 'content' && file.lineContent && (
									<Text
										backgroundColor={
											isSelected ? theme.colors.menuSelected : undefined
										}
										color={theme.colors.menuSecondary}
										dimColor
									>
										{'  '}
										{file.lineContent}
									</Text>
								)}
							</Box>
						);
					})}
					{displayItems.length > effectiveMaxItems && (
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.commandPanel.scrollHint}
								{hiddenAboveCount > 0 && (
									<>
										·{' '}
										{t.commandPanel.moreAbove.replace(
											'{count}',
											hiddenAboveCount.toString(),
										)}
									</>
								)}
								{hiddenBelowCount > 0 && (
									<>
										·{' '}
										{t.commandPanel.moreBelow.replace(
											'{count}',
											hiddenBelowCount.toString(),
										)}
									</>
								)}
							</Text>
						</Box>
					)}
					{selectedFileFullPath && (
						<Box marginTop={displayItems.length > effectiveMaxItems ? 0 : 1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{'⤷ ' + selectedFileFullPath}
							</Text>
						</Box>
					)}
					{isLoading && (
						<Box>
							<Text color="blue" dimColor>
								{isIncreasingDepth
									? t.fileList.scanningDeeper
											.replace('{depth}', searchDepth.toString())
											.replace('{count}', files.length.toString())
									: t.fileList.scanning.replace(
											'{count}',
											files.length.toString(),
									  )}
							</Text>
						</Box>
					)}
					{/* Surface a hint at the bottom whenever there are still
					    deeper directories that have not been scanned, so the
					    user knows they can press ↓ on the last item to dig
					    deeper instead of assuming the list is exhaustive. */}
					{searchMode === 'file' &&
						hasMoreDepth &&
						!isLoading &&
						!isIncreasingDepth &&
						displayItems.length > 0 && (
							<Box>
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.fileList.deeperSearchHint}
								</Text>
							</Box>
						)}
				</Box>
			);
		},
	),
);

FileList.displayName = 'FileList';

export default FileList;
