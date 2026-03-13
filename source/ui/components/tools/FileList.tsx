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
};

type DisplayMode = 'list' | 'tree';

type DisplayItem = {
	file: FileItem;
	key: string;
	label: string;
	depth: number;
	isContextOnly?: boolean;
};

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
			const [searchDepth, setSearchDepth] = useState(5); // Start with shallow depth for performance
			const [isIncreasingDepth, setIsIncreasingDepth] = useState(false);
			const [hasMoreDepth, setHasMoreDepth] = useState(true); // Track if there's more depth to explore
			const [displayMode, setDisplayMode] = useState<DisplayMode>('list');

			// Get terminal size for dynamic content display
			const {columns: terminalWidth} = useTerminalSize();

			// Fixed maximum display items to prevent rendering issues
			const MAX_DISPLAY_ITEMS = 5;
			const effectiveMaxItems = useMemo(() => {
				return maxItems
					? Math.min(maxItems, MAX_DISPLAY_ITEMS)
					: MAX_DISPLAY_ITEMS;
			}, [maxItems]);

			// Get files from directory with progressive depth search
			const loadFiles = useCallback(async () => {
				const MAX_FILES = 3000; // Increased limit for multiple directories

				// Get all working directories
				const workingDirs = await getWorkingDirectories();
				const allFiles: FileItem[] = [];
				let globalMaxDepth = 0;

				// Load files from each working directory
				for (const workingDir of workingDirs) {
					const dirPath = workingDir.path;

					// Handle remote SSH directories
					if (workingDir.isRemote && workingDir.sshConfig) {
						try {
							const sshInfo = parseSSHUrl(dirPath);
							if (!sshInfo) {
								continue;
							}

							// Add the remote working directory itself to the list
							const remoteDirName =
								sshInfo.path.split('/').pop() || sshInfo.host;
							allFiles.push({
								name: remoteDirName,
								path: dirPath, // Show full SSH URL as path
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

							// Get remote files recursively
							const getRemoteFilesRecursively = async (
								remotePath: string,
								depth: number = 0,
								maxDepth: number = searchDepth,
								maxFiles: number = MAX_FILES,
							): Promise<{files: FileItem[]; maxDepthReached: number}> => {
								if (depth > maxDepth) {
									return {files: [], maxDepthReached: depth - 1};
								}

								try {
									const entries = await sshClient.listDirectory(remotePath);
									let result: FileItem[] = [];
									let currentMaxDepth = depth;

									const baseIgnorePatterns = [
										'node_modules',
										'dist',
										'build',
										'coverage',
										'.git',
										'.vscode',
										'.idea',
										'out',
										'target',
										'bin',
										'obj',
										'.next',
										'.nuxt',
										'vendor',
										'__pycache__',
										'.pytest_cache',
										'.mypy_cache',
										'venv',
										'.venv',
										'env',
										'.env',
									];

									for (const entry of entries) {
										if (result.length >= maxFiles) break;

										if (
											(entry.name.startsWith('.') && entry.name !== '.snow') ||
											baseIgnorePatterns.includes(entry.name)
										) {
											continue;
										}

										const fullRemotePath = remotePath + '/' + entry.name;
										let relativePath = fullRemotePath.substring(
											sshInfo.path.length,
										);
										if (!relativePath.startsWith('/')) {
											relativePath = '/' + relativePath;
										}
										relativePath = '.' + relativePath;

										result.push({
											name: entry.name,
											path: relativePath,
											isDirectory: entry.isDirectory,
											sourceDir: dirPath, // SSH URL as source
										});

										if (entry.isDirectory && depth < maxDepth) {
											const subResult = await getRemoteFilesRecursively(
												fullRemotePath,
												depth + 1,
												maxDepth,
												maxFiles,
											);
											result = result.concat(subResult.files);
											currentMaxDepth = Math.max(
												currentMaxDepth,
												subResult.maxDepthReached,
											);
										}
									}

									return {files: result, maxDepthReached: currentMaxDepth};
								} catch {
									return {files: [], maxDepthReached: depth};
								}
							};

							const remoteResult = await getRemoteFilesRecursively(
								sshInfo.path,
							);
							allFiles.push(...remoteResult.files);
							globalMaxDepth = Math.max(
								globalMaxDepth,
								remoteResult.maxDepthReached,
							);

							sshClient.disconnect();
						} catch {
							// SSH connection failed, skip this directory
						}

						if (allFiles.length >= MAX_FILES) {
							break;
						}
						continue;
					}

					// Handle local directories
					// Add the local working directory itself to the list
					const localDirName = path.basename(dirPath) || dirPath;
					allFiles.push({
						name: localDirName,
						path: dirPath, // Show full path
						isDirectory: true,
						sourceDir: dirPath,
					});

					// Read .gitignore patterns for this directory
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

					const getFilesRecursively = async (
						dir: string,
						depth: number = 0,
						maxDepth: number = searchDepth,
						maxFiles: number = MAX_FILES,
					): Promise<{files: FileItem[]; maxDepthReached: number}> => {
						// Stop recursion if depth limit reached
						if (depth > maxDepth) {
							return {files: [], maxDepthReached: depth - 1};
						}

						try {
							const entries = await fs.promises.readdir(dir, {
								withFileTypes: true,
							});
							let result: FileItem[] = [];
							let currentMaxDepth = depth; // Track deepest level we actually explored

							// Common ignore patterns for better performance
							const baseIgnorePatterns = [
								'node_modules',
								'dist',
								'build',
								'coverage',
								'.git',
								'.vscode',
								'.idea',
								'out',
								'target',
								'bin',
								'obj',
								'.next',
								'.nuxt',
								'vendor',
								'__pycache__',
								'.pytest_cache',
								'.mypy_cache',
								'venv',
								'.venv',
								'env',
								'.env',
							];

							// Merge base patterns with .gitignore patterns
							const ignorePatterns = [
								...baseIgnorePatterns,
								...gitignorePatterns,
							];

							for (const entry of entries) {
								// Early exit if we've collected enough files
								if (result.length >= maxFiles) {
									break;
								}

								// Skip hidden files and ignore patterns
								// Note: .snow directory is explicitly allowed
								if (
									(entry.name.startsWith('.') && entry.name !== '.snow') ||
									ignorePatterns.includes(entry.name)
								) {
									continue;
								}

								const fullPath = path.join(dir, entry.name);

								// Skip if file is too large (> 10MB) for performance
								try {
									const stats = await fs.promises.stat(fullPath);
									if (!entry.isDirectory() && stats.size > 10 * 1024 * 1024) {
										continue;
									}
								} catch {
									continue;
								}

								let relativePath = path.relative(dirPath, fullPath);

								// Ensure relative paths start with ./ for consistency
								if (
									!relativePath.startsWith('.') &&
									!path.isAbsolute(relativePath)
								) {
									relativePath = './' + relativePath;
								}

								// Normalize to forward slashes for cross-platform consistency
								relativePath = relativePath.replace(/\\/g, '/');

								result.push({
									name: entry.name,
									path: relativePath,
									isDirectory: entry.isDirectory(),
									sourceDir: dirPath, // Track source directory
								});

								// Recursively get files from subdirectories with depth limit
								if (entry.isDirectory() && depth < maxDepth) {
									const subResult = await getFilesRecursively(
										fullPath,
										depth + 1,
										maxDepth,
										maxFiles,
									);
									result = result.concat(subResult.files);
									// Track the deepest level reached
									currentMaxDepth = Math.max(
										currentMaxDepth,
										subResult.maxDepthReached,
									);
								}
							}

							return {files: result, maxDepthReached: currentMaxDepth};
						} catch (error) {
							return {files: [], maxDepthReached: depth};
						}
					};

					// Load files from this directory
					const dirResult = await getFilesRecursively(dirPath);
					allFiles.push(...dirResult.files);
					globalMaxDepth = Math.max(globalMaxDepth, dirResult.maxDepthReached);

					// Stop if we've collected enough files
					if (allFiles.length >= MAX_FILES) {
						break;
					}
				}

				// Check if we've hit the depth limit (might have deeper directories)
				const hitDepthLimit = globalMaxDepth >= searchDepth - 1;

				// Batch all state updates together
				setIsLoading(true);
				setFiles(allFiles);
				setHasMoreDepth(hitDepthLimit);
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

					// Text file extensions to search
					const textExtensions = new Set([
						'.js',
						'.jsx',
						'.ts',
						'.tsx',
						'.py',
						'.java',
						'.c',
						'.cpp',
						'.h',
						'.hpp',
						'.cs',
						'.go',
						'.rs',
						'.rb',
						'.php',
						'.swift',
						'.kt',
						'.scala',
						'.sh',
						'.bash',
						'.zsh',
						'.fish',
						'.ps1',
						'.html',
						'.css',
						'.scss',
						'.sass',
						'.less',
						'.xml',
						'.json',
						'.yaml',
						'.yml',
						'.toml',
						'.ini',
						'.conf',
						'.config',
						'.txt',
						'.md',
						'.markdown',
						'.rst',
						'.tex',
						'.sql',
						'.graphql',
						'.proto',
						'.vue',
						'.svelte',
					]);

					// Filter to only text files
					const filesToSearch = files.filter(f => {
						if (f.isDirectory) return false;
						const ext = path.extname(f.path).toLowerCase();
						return textExtensions.has(ext);
					});

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

						// Progressive depth increase: automatically increase depth until found
						// Stop conditions: found files OR no more depth (reached project's max depth)
						if (
							filtered.length === 0 &&
							query.trim().length > 0 &&
							hasMoreDepth
						) {
							// Increase search depth progressively (step by 5)
							const newDepth = searchDepth + 5;
							setSearchDepth(newDepth);
							setIsIncreasingDepth(true);

							// Reset indicator after a short delay
							setTimeout(() => {
								setIsIncreasingDepth(false);
							}, 300);
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
				searchDepth,
				loadFiles,
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

						setDisplayMode(prev => (prev === 'list' ? 'tree' : 'list'));
						return true;
					},
				}),
				[displayItems, normalizedSelectedIndex, rootPath, searchMode],
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

			if (isLoading) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color="blue" dimColor>
							{isIncreasingDepth
								? `Searching deeper directories (depth: ${searchDepth})...`
								: 'Loading files...'}
						</Text>
					</Box>
				);
			}

			if (displayItems.length === 0) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{isIncreasingDepth
								? 'Searching deeper directories...'
								: 'No files found'}
						</Text>
					</Box>
				);
			}

			return (
				<Box paddingX={1} marginTop={1} flexDirection="column">
					<Box marginBottom={1}>
						<Text color="blue" bold>
							{searchMode === 'content'
								? '≡ Content Search'
								: `≡ Files [${
										displayMode === 'tree' ? 'Tree' : 'List'
								  } • Ctrl+T]`}{' '}
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
				</Box>
			);
		},
	),
);

FileList.displayName = 'FileList';

export default FileList;
