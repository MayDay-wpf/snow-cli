import React, {
	useState,
	useEffect,
	useMemo,
	useCallback,
	forwardRef,
	useImperativeHandle,
	useRef,
	memo,
} from 'react';
import {Box, Text} from 'ink';
import fs from 'fs';
import path from 'path';
import stringWidth from 'string-width';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {getWorkingDirectories} from '../../../utils/config/workingDirConfig.js';
import {SSHClient, parseSSHUrl} from '../../../utils/ssh/sshClient.js';
import {
	getFileListDisplayMode,
	setFileListDisplayMode,
} from '../../../utils/config/projectSettings.js';
import {
	fileSearchAgent,
	type FileSearchPreviewLabels,
	type FileSearchResult,
} from '../../../agents/fileSearchAgent.js';

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
	// Toggle current highlighted item's checkbox selection for multi-select.
	// Returns true if the toggle was performed (item exists and is selectable).
	toggleSelection: () => boolean;
	// Return all currently checkbox-selected file paths (already expanded to
	// absolute / SSH form and with line-number suffix where applicable).
	// Returns null when nothing is checkbox-selected, so the caller can fall
	// back to the original single-item flow.
	getSelectedFiles: () => string[] | null;
	// Clear all checkbox selections. Used after a successful multi-insert.
	clearSelections: () => void;
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

const AGENT_PREVIEW_VIEWPORT_HEIGHT = 5;
const AGENT_PREVIEW_INDENT_WIDTH = 2;
const AGENT_PREVIEW_RESERVED_COLUMNS = 8;
const AGENT_PREVIEW_PANEL_PADDING = 2;

type AgentPreviewLine = {
	text: string;
};

const normalizeAgentPreviewContent = (content: string | undefined): string => {
	return (
		content
			?.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/[\t\v\f]+/g, ' ') ?? ''
	);
};

const sliceByVisualWidth = (text: string, maxWidth: number): string => {
	if (!text || maxWidth <= 0) {
		return '';
	}

	let result = '';
	let width = 0;
	for (const char of text) {
		const charWidth = stringWidth(char);
		if (width + charWidth > maxWidth) {
			break;
		}
		result += char;
		width += charWidth;
	}

	return result;
};

const getSafeAgentPreviewLineWidth = (terminalWidth: number): number => {
	return Math.max(
		1,
		terminalWidth -
			AGENT_PREVIEW_INDENT_WIDTH -
			AGENT_PREVIEW_RESERVED_COLUMNS -
			AGENT_PREVIEW_PANEL_PADDING,
	);
};

const buildAgentPreviewLines = (
	content: string | undefined,
	terminalWidth: number,
	fallback: string,
): AgentPreviewLine[] => {
	const width = getSafeAgentPreviewLineWidth(terminalWidth);
	const normalized = normalizeAgentPreviewContent(content).trim();
	const logicalLines = (normalized || fallback).split('\n');
	const visibleLines = logicalLines.slice(-AGENT_PREVIEW_VIEWPORT_HEIGHT);

	return [
		...Array(
			Math.max(0, AGENT_PREVIEW_VIEWPORT_HEIGHT - visibleLines.length),
		).fill({text: ' '}),
		...visibleLines.map(line => ({
			text: sliceByVisualWidth(line || ' ', width) || ' ',
		})),
	];
};

const buildSafeAgentPreviewTitle = (
	title: string,
	terminalWidth: number,
): string => {
	return sliceByVisualWidth(title, Math.max(1, terminalWidth - 1)) || ' ';
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
			// Checkbox multi-select: stores the full insertion paths (the exact
			// string returned by getFullFilePath / with optional :line suffix).
			// Using the resolved path keeps selections stable when the filtered
			// list changes underneath the user (e.g. typing narrows results).
			const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
				() => new Set(),
			);
			const wasVisibleRef = useRef(false);
			const previousRootPathRef = useRef(rootPath);

			// Agent search state (@?? / @@?? natural-language file search).
			const [agentResults, setAgentResults] = useState<FileItem[]>([]);
			const [isAgentSearching, setIsAgentSearching] = useState(false);
			const [agentRound, setAgentRound] = useState(0);
			const [agentPreviewContent, setAgentPreviewContent] = useState('');
			const [agentError, setAgentError] = useState<string | null>(null);
			const agentAbortRef = useRef<AbortController | null>(null);
			const wasAgentModeRef = useRef(false);
			// True when the @ / @@ query starts with "??" → trigger the AI agent.
			const isAgentMode = query.startsWith('??');

			// Get terminal size for dynamic content display
			const {columns: terminalWidth} = useTerminalSize();

			const agentPreviewLabels = useMemo<FileSearchPreviewLabels>(
				() => ({
					assistantPrefix: t.fileList.agentPreviewAssistantPrefix,
					roundRequest: t.fileList.agentPreviewRoundRequest,
					requestedToolCalls: t.fileList.agentPreviewRequestedToolCalls,
					toolCall: t.fileList.agentPreviewToolCall,
					toolResultCandidates: t.fileList.agentPreviewToolResultCandidates,
					toolResultReceived: t.fileList.agentPreviewToolResultReceived,
					toolError: t.fileList.agentPreviewToolError,
					parsingFinalResults: t.fileList.agentPreviewParsingFinalResults,
					finalizing: t.fileList.agentPreviewFinalizing,
				}),
				[
					t.fileList.agentPreviewAssistantPrefix,
					t.fileList.agentPreviewRoundRequest,
					t.fileList.agentPreviewRequestedToolCalls,
					t.fileList.agentPreviewToolCall,
					t.fileList.agentPreviewToolResultCandidates,
					t.fileList.agentPreviewToolResultReceived,
					t.fileList.agentPreviewToolError,
					t.fileList.agentPreviewParsingFinalResults,
					t.fileList.agentPreviewFinalizing,
				],
			);

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

			// Load files when component becomes visible or search depth changes.
			// This ensures the file list is always fresh without complex file watching.
			useEffect(() => {
				const wasVisible = wasVisibleRef.current;
				wasVisibleRef.current = visible;

				if (!visible) {
					return;
				}

				const rootPathChanged = previousRootPathRef.current !== rootPath;
				previousRootPathRef.current = rootPath;

				// Start with a clean multi-select slate only when opening a new
				// picker session or switching roots. Deeper searches also rerun
				// this effect through `loadFiles`, but must preserve already
				// checked files while the same picker session stays visible.
				if (!wasVisible || rootPathChanged) {
					setSelectedKeys(prev => (prev.size === 0 ? prev : new Set()));
				}

				// Always reload when becoming visible to ensure fresh data, and reload
				// when progressive depth changes to scan deeper directories.
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
					// Drop pending multi-select after the panel is fully closed
					// so the next session starts fresh; quick reopen still keeps
					// the checks (the timeout has not fired yet).
					setSelectedKeys(prev => (prev.size === 0 ? prev : new Set()));
				}, SEARCH_RESULT_TTL_MS);

				return () => clearTimeout(timer);
			}, [visible]);

			// Filter files based on query and search mode with debounce
			useEffect(() => {
				// Agent mode (@?? / @@??): bypass the BFS index + filter pipeline
				// and surface the agent's results directly.
				if (isAgentMode) {
					setAllFilteredFiles(agentResults);
					return;
				}

				const performSearch = async () => {
					if (!query.trim()) {
						setAllFilteredFiles(files);
						return;
					}

					if (searchMode === 'content') {
						// Content search mode (@@)
						const results = await searchFileContent(query);
						setAllFilteredFiles(results);

						// Content search uses the same progressively loaded file index as
						// file-name search. If the current shallow index has no matches,
						// expand the scan so deeper files can be read and searched.
						if (
							!isLoading &&
							results.length === 0 &&
							query.trim().length > 0 &&
							hasMoreDepth
						) {
							setSearchDepth(d => d + 3);
							setIsIncreasingDepth(true);
							setTimeout(() => setIsIncreasingDepth(false), 400);
						}
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
				isAgentMode,
				agentResults,
			]);

			// Agent search (@?? / @@??): run the file search agent in its own AI
			// loop and stream status previews into `agentPreviewContent`. Debounced so
			// the user can finish typing; previous searches are aborted on query change.
			useEffect(() => {
				const agentQuery = isAgentMode ? query.slice(2).trim() : '';

				if (!visible || !isAgentMode || !agentQuery) {
					// Leaving agent mode (or empty query): cancel + reset once.
					if (wasAgentModeRef.current) {
						wasAgentModeRef.current = false;
						if (agentAbortRef.current) {
							agentAbortRef.current.abort();
							agentAbortRef.current = null;
						}
						setIsAgentSearching(false);
						setAgentError(null);
						setAgentResults([]);
						setAgentRound(0);
						setAgentPreviewContent('');
					}
					return;
				}

				wasAgentModeRef.current = true;
				const controller = new AbortController();
				agentAbortRef.current = controller;

				const mapResult = (r: FileSearchResult): FileItem => ({
					name: r.name,
					path: r.path,
					isDirectory: false,
					lineNumber: r.lineNumber,
					lineContent: r.lineContent || r.reason,
					sourceDir: r.sourceDir,
				});

				const timer = setTimeout(async () => {
					setIsAgentSearching(true);
					setAgentError(null);
					setAgentResults([]);
					setAgentRound(0);
					setAgentPreviewContent('');

					try {
						const workingDirs = await getWorkingDirectories();
						const generator = fileSearchAgent.search(
							agentQuery,
							searchMode,
							workingDirs,
							controller.signal,
							agentPreviewLabels,
						);
						for await (const event of generator) {
							if (controller.signal.aborted) {
								break;
							}
							if (event.type === 'progress') {
								setAgentRound(event.round);
							} else if (event.type === 'preview') {
								setAgentRound(event.round);
								setAgentPreviewContent(event.content);
							} else if (event.type === 'done') {
								// Only show results once the agent has fully finished.
								// Showing partials mid-loop makes the user think the
								// search is already over when it is still running.
								setAgentResults(event.results.map(mapResult));
							} else if (event.type === 'error') {
								setAgentError(event.message);
							}
						}
					} catch (error) {
						if (!controller.signal.aborted) {
							setAgentError(
								error instanceof Error ? error.message : 'Agent search failed',
							);
						}
					} finally {
						if (agentAbortRef.current === controller) {
							agentAbortRef.current = null;
						}
						setIsAgentSearching(false);
					}
				}, 700);

				return () => {
					clearTimeout(timer);
					controller.abort();
				};
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [query, searchMode, visible, isAgentMode, agentPreviewLabels]);

			const displayItems = useMemo<DisplayItem[]>(() => {
				if (isAgentMode || searchMode === 'content') {
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
			}, [
				allFilteredFiles,
				files,
				displayMode,
				searchMode,
				query,
				isAgentMode,
			]);

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

			// Resolve the canonical "insertion path" for a display entry.
			// Mirrors what `getSelectedFile` returns so that toggleSelection and
			// getSelectedFiles produce the exact same strings — guaranteeing the
			// keys in `selectedKeys` map 1:1 with what handleFileSelect will
			// receive when Enter is pressed.
			const resolveInsertionPath = useCallback(
				(entry: DisplayItem): string | null => {
					if (!entry) {
						return null;
					}
					const fullPath = getFullFilePath(entry.file, rootPath);

					if (entry.file.isDirectory && searchMode === 'file') {
						const normalizedDirectoryPath = fullPath.replace(/\\/g, '/');
						return normalizedDirectoryPath.endsWith('/')
							? normalizedDirectoryPath
							: `${normalizedDirectoryPath}/`;
					}

					if (entry.file.lineNumber !== undefined) {
						return `${fullPath}:${entry.file.lineNumber}`;
					}

					return fullPath;
				},
				[rootPath, searchMode],
			);

			useImperativeHandle(
				ref,
				() => ({
					getSelectedFile: () => {
						const selectedEntry = displayItems[normalizedSelectedIndex];
						if (!selectedEntry) {
							return null;
						}
						return resolveInsertionPath(selectedEntry);
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
						// Content search also reads from this progressively loaded file
						// index, so both @ file search and @@ content search must be
						// allowed to request a deeper scan.
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
					toggleSelection: () => {
						const selectedEntry = displayItems[normalizedSelectedIndex];
						if (!selectedEntry) {
							return false;
						}
						// Directories are now allowed in the multi-select set
						// too; they will be inserted as `@dir/` references on
						// Enter just like files. Directory drill-down (single
						// Enter without any checkbox) is still handled by the
						// fallback path in filePicker.ts.
						const key = resolveInsertionPath(selectedEntry);
						if (!key) {
							return false;
						}
						setSelectedKeys(prev => {
							const next = new Set(prev);
							if (next.has(key)) {
								next.delete(key);
							} else {
								next.add(key);
							}
							return next;
						});
						return true;
					},
					getSelectedFiles: () => {
						if (selectedKeys.size === 0) {
							return null;
						}
						// Preserve the on-screen ordering rather than insertion
						// order so that the inserted text follows the list the
						// user sees.
						const ordered: string[] = [];
						const seen = new Set<string>();
						for (const entry of displayItems) {
							const key = resolveInsertionPath(entry);
							if (key && selectedKeys.has(key) && !seen.has(key)) {
								ordered.push(key);
								seen.add(key);
							}
						}
						// Include any selections that no longer match the current
						// filter (so narrowing the query does not silently lose
						// them when Enter is pressed).
						for (const key of selectedKeys) {
							if (!seen.has(key)) {
								ordered.push(key);
								seen.add(key);
							}
						}
						return ordered;
					},
					clearSelections: () => {
						setSelectedKeys(prev => (prev.size === 0 ? prev : new Set()));
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
					displayMode,
					selectedKeys,
					resolveInsertionPath,
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

			// Agent search mode (@?? / @@??): handle its own loading / error /
			// empty states before falling through to the normal render path.
			if (isAgentMode) {
				if (isAgentSearching && displayItems.length === 0) {
					const agentSearchStatus = t.fileList.agentSearching.replace(
						'{round}',
						String(agentRound || 1),
					);
					const previewLines = buildAgentPreviewLines(
						agentPreviewContent,
						terminalWidth,
						agentSearchStatus,
					);
					const previewTitle = buildSafeAgentPreviewTitle(
						agentSearchStatus,
						terminalWidth,
					);

					return (
						<Box
							paddingX={1}
							marginTop={1}
							flexDirection="column"
							width={terminalWidth}
						>
							<Box height={1}>
								<Text color={theme.colors.menuInfo} bold wrap="truncate">
									{previewTitle}
								</Text>
							</Box>
							<Box
								paddingLeft={AGENT_PREVIEW_INDENT_WIDTH}
								marginTop={1}
								flexDirection="column"
							>
								{previewLines.map((line, index) => (
									<Box key={`agent-preview-line-${index}`} height={1}>
										<Text
											italic
											dimColor
											color={theme.colors.menuSecondary}
											wrap="truncate"
										>
											{line.text}
										</Text>
									</Box>
								))}
							</Box>
						</Box>
					);
				}
				if (agentError && displayItems.length === 0) {
					return (
						<Box paddingX={1} marginTop={1}>
							<Text color={theme.colors.warning}>
								{t.fileList.agentSearchError.replace('{error}', agentError)}
							</Text>
						</Box>
					);
				}
				if (!isAgentSearching && !agentError && displayItems.length === 0) {
					return (
						<Box paddingX={1} marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.fileList.agentNoResults}
							</Text>
						</Box>
					);
				}
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

			if (!isAgentMode && stillSearching && displayItems.length === 0) {
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
							{isAgentMode
								? t.fileList.agentSearchHeader
								: searchMode === 'content'
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
							isAgentMode || searchMode === 'content'
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
						// Every visible entry (files AND directories) gets a
						// checkbox now — directories that are checked will be
						// inserted as `@dir/` references on Enter, instead of
						// drilling into the directory.
						const itemInsertionKey = resolveInsertionPath(item);
						const isChecked =
							itemInsertionKey !== null && selectedKeys.has(itemInsertionKey);
						const checkbox = isChecked ? '[✓] ' : '[ ] ';
						return (
							<Box key={item.key} flexDirection="column">
								<Text
									backgroundColor={
										isSelected ? theme.colors.menuSelected : undefined
									}
									color={color}
									dimColor={Boolean(item.isContextOnly && !isSelected)}
									wrap={
										isAgentMode || searchMode === 'content'
											? 'truncate-end'
											: 'wrap'
									}
								>
									{isSelected ? '❯ ' : '  '}
									{checkbox}
									{isAgentMode || searchMode === 'content'
										? item.label
										: `${prefix}${item.label}`}
								</Text>
								{(isAgentMode || searchMode === 'content') &&
									file.lineContent && (
										<Box overflow="hidden">
											<Text
												backgroundColor={
													isSelected ? theme.colors.menuSelected : undefined
												}
												color={theme.colors.menuSecondary}
												dimColor
												wrap="truncate-end"
											>
												{'  '}
												{file.lineContent}
											</Text>
										</Box>
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
							<Text color={theme.colors.menuSecondary}>
								{'⤷ ' + selectedFileFullPath}
							</Text>
						</Box>
					)}
					{!isAgentMode && isLoading && (
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
					{!isAgentMode &&
						searchMode === 'file' &&
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
					{/* Multi-select hint + count summary. Space toggles the
					    checkbox on the current item; pressing Enter inserts
					    every checked item separated by a space. */}
					{displayItems.length > 0 && (
						<Box>
							<Text color={theme.colors.menuSecondary}>
								{selectedKeys.size > 0
									? t.fileList.multiSelectActiveHint.replace(
											'{count}',
											selectedKeys.size.toString(),
									  )
									: t.fileList.multiSelectHint}
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
