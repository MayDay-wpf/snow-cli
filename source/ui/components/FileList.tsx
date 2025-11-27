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
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useTheme} from '../contexts/ThemeContext.js';

type FileItem = {
	name: string;
	path: string;
	isDirectory: boolean;
	// For content search mode
	lineNumber?: number;
	lineContent?: string;
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
			const {theme} = useTheme();
			const [files, setFiles] = useState<FileItem[]>([]);
			const [isLoading, setIsLoading] = useState(false);

			// Get terminal size for dynamic content display
			const {columns: terminalWidth} = useTerminalSize();

			// Fixed maximum display items to prevent rendering issues
			const MAX_DISPLAY_ITEMS = 5;
			const effectiveMaxItems = useMemo(() => {
				return maxItems
					? Math.min(maxItems, MAX_DISPLAY_ITEMS)
					: MAX_DISPLAY_ITEMS;
			}, [maxItems]);

			// Read .gitignore patterns at the start
			const readGitignore = useCallback(async (): Promise<string[]> => {
				const gitignorePath = path.join(rootPath, '.gitignore');
				try {
					const content = await fs.promises.readFile(gitignorePath, 'utf-8');
					return content
						.split('\n')
						.map(line => line.trim())
						.filter(line => line && !line.startsWith('#'))
						.map(line => line.replace(/\/$/, '')); // Remove trailing slashes
				} catch {
					return [];
				}
			}, [rootPath]);

			// Get files from directory - optimized for performance with depth limit
			const loadFiles = useCallback(async () => {
				const MAX_DEPTH = 5; // Limit recursion depth to prevent performance issues
				const MAX_FILES = 1000; // Reduced from 2000 for better performance

				// Read .gitignore patterns
				const gitignorePatterns = await readGitignore();

				const getFilesRecursively = async (
					dir: string,
					depth: number = 0,
				): Promise<FileItem[]> => {
					// Stop recursion if depth limit reached
					if (depth > MAX_DEPTH) {
						return [];
					}

					try {
						const entries = await fs.promises.readdir(dir, {
							withFileTypes: true,
						});
						let result: FileItem[] = [];

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
							if (result.length >= MAX_FILES) {
								break;
							}

							// Skip hidden files and ignore patterns
							if (
								entry.name.startsWith('.') ||
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

							let relativePath = path.relative(rootPath, fullPath);

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
							});

							// Recursively get files from subdirectories with depth limit
							if (entry.isDirectory() && depth < MAX_DEPTH) {
								const subFiles = await getFilesRecursively(fullPath, depth + 1);
								result = result.concat(subFiles);
							}
						}

						return result;
					} catch (error) {
						return [];
					}
				};

				// Batch all state updates together
				setIsLoading(true);
				const fileList = await getFilesRecursively(rootPath);
				setFiles(fileList);
				setIsLoading(false);
			}, [rootPath, readGitignore]);

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
								const fullPath = path.join(rootPath, file.path);
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
						const queryLower = query.toLowerCase();
						const filtered = files.filter(file => {
							const fileName = file.name.toLowerCase();
							const filePath = file.path.toLowerCase();
							return (
								fileName.includes(queryLower) || filePath.includes(queryLower)
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
					}
				};

				// Debounce search to avoid excessive updates during fast typing
				// Use shorter delay for file search (150ms) and longer for content search (500ms)
				const debounceDelay = searchMode === 'content' ? 500 : 150;
				const timer = setTimeout(() => {
					performSearch();
				}, debounceDelay);

				return () => clearTimeout(timer);
			}, [files, query, searchMode, searchFileContent]);

			// Display with scrolling window
			const filteredFiles = useMemo(() => {
				if (allFilteredFiles.length <= effectiveMaxItems) {
					return allFilteredFiles;
				}

				// Show files around the selected index
				const halfWindow = Math.floor(effectiveMaxItems / 2);
				let startIndex = Math.max(0, selectedIndex - halfWindow);
				let endIndex = Math.min(
					allFilteredFiles.length,
					startIndex + effectiveMaxItems,
				);

				// Adjust if we're near the end
				if (endIndex - startIndex < effectiveMaxItems) {
					startIndex = Math.max(0, endIndex - effectiveMaxItems);
				}

				return allFilteredFiles.slice(startIndex, endIndex);
			}, [allFilteredFiles, selectedIndex, effectiveMaxItems]);

			// Notify parent of filtered count changes
			useEffect(() => {
				if (onFilteredCountChange) {
					onFilteredCountChange(allFilteredFiles.length);
				}
			}, [allFilteredFiles.length, onFilteredCountChange]);

			// Expose methods to parent
			useImperativeHandle(
				ref,
				() => ({
					getSelectedFile: () => {
						if (
							allFilteredFiles.length > 0 &&
							selectedIndex < allFilteredFiles.length &&
							allFilteredFiles[selectedIndex]
						) {
							const selectedFile = allFilteredFiles[selectedIndex];
							// For content search mode, include line number
							if (selectedFile.lineNumber !== undefined) {
								return `${selectedFile.path}:${selectedFile.lineNumber}`;
							}
							return selectedFile.path;
						}
						return null;
					},
				}),
				[allFilteredFiles, selectedIndex],
			);

			// Calculate display index for the scrolling window
			// MUST be before early returns to avoid hook order issues
			const displaySelectedIndex = useMemo(() => {
				return filteredFiles.findIndex(file => {
					const originalIndex = allFilteredFiles.indexOf(file);
					return originalIndex === selectedIndex;
				});
			}, [filteredFiles, allFilteredFiles, selectedIndex]);

			if (!visible) {
				return null;
			}

			if (isLoading) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color="blue" dimColor>
							Loading files...
						</Text>
					</Box>
				);
			}

			if (filteredFiles.length === 0) {
				return (
					<Box paddingX={1} marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							No files found
						</Text>
					</Box>
				);
			}

			return (
				<Box paddingX={1} marginTop={1} flexDirection="column">
					<Box marginBottom={1}>
						<Text color="blue" bold>
							{searchMode === 'content' ? '≡ Content Search' : '≡ Files'}{' '}
							{allFilteredFiles.length > effectiveMaxItems &&
								`(${selectedIndex + 1}/${allFilteredFiles.length})`}
						</Text>
					</Box>
					{filteredFiles.map((file, index) => (
						<Box
							key={`${file.path}-${file.lineNumber || 0}`}
							flexDirection="column"
						>
							{/* First line: file path and line number (for content search) or file path (for file search) */}
							<Text
								backgroundColor={
									index === displaySelectedIndex
										? theme.colors.menuSelected
										: undefined
								}
								color={
									index === displaySelectedIndex
										? theme.colors.menuNormal
										: file.isDirectory
										? theme.colors.warning
										: 'white'
								}
							>
								{searchMode === 'content' && file.lineNumber !== undefined
									? `${file.path}:${file.lineNumber}`
									: file.isDirectory
									? '◇ ' + file.path
									: '◆ ' + file.path}
							</Text>
							{/* Second line: code content (only for content search) */}
							{searchMode === 'content' && file.lineContent && (
								<Text
									backgroundColor={
										index === displaySelectedIndex
											? theme.colors.menuSelected
											: undefined
									}
									color={
										index === displaySelectedIndex
											? theme.colors.menuSecondary
											: theme.colors.menuSecondary
									}
									dimColor
								>
									{'  '}
									{file.lineContent}
								</Text>
							)}
						</Box>
					))}
					{allFilteredFiles.length > effectiveMaxItems && (
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								↑↓ to scroll · {allFilteredFiles.length - effectiveMaxItems}{' '}
								more hidden
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
