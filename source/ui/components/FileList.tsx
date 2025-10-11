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

type FileItem = {
	name: string;
	path: string;
	isDirectory: boolean;
};

type Props = {
	query: string;
	selectedIndex: number;
	visible: boolean;
	maxItems?: number;
	rootPath?: string;
	onFilteredCountChange?: (count: number) => void;
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
			},
			ref,
		) => {
			const [files, setFiles] = useState<FileItem[]>([]);
			const [isLoading, setIsLoading] = useState(false);

			// Fixed maximum display items to prevent rendering issues
			const MAX_DISPLAY_ITEMS = 5;
			const effectiveMaxItems = useMemo(() => {
				return maxItems
					? Math.min(maxItems, MAX_DISPLAY_ITEMS)
					: MAX_DISPLAY_ITEMS;
			}, [maxItems]);

			// Get files from directory - optimized for performance with no depth limit
			const loadFiles = useCallback(async () => {
				const getFilesRecursively = async (
					dir: string,
					depth: number = 0,
				): Promise<FileItem[]> => {
					try {
						const entries = await fs.promises.readdir(dir, {
							withFileTypes: true,
						});
						let result: FileItem[] = [];

						// Common ignore patterns for better performance
						const ignorePatterns = [
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

							result.push({
								name: entry.name,
								path: relativePath,
								isDirectory: entry.isDirectory(),
							});

							// Recursively get files from subdirectories (no depth limit)
							if (entry.isDirectory()) {
								const subFiles = await getFilesRecursively(fullPath, depth + 1);
								result = result.concat(subFiles);
							}

							// Limit total files for performance (increased from 500 to 2000)
							if (result.length > 2000) {
								break;
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
			}, [rootPath]);

			// Load files on mount - only once when visible
			useEffect(() => {
				if (visible && files.length === 0) {
					loadFiles();
				}
			}, [visible, loadFiles]);

			// Filter files based on query (no limit here, we'll slice for display)
			const allFilteredFiles = useMemo(() => {
				if (!query.trim()) {
					return files;
				}

				const queryLower = query.toLowerCase();
				const filtered = files.filter(file => {
					const fileName = file.name.toLowerCase();
					const filePath = file.path.toLowerCase();
					return fileName.includes(queryLower) || filePath.includes(queryLower);
				});

				// Sort by relevance (exact name matches first, then path matches)
				filtered.sort((a, b) => {
					const aNameMatch = a.name.toLowerCase().startsWith(queryLower);
					const bNameMatch = b.name.toLowerCase().startsWith(queryLower);

					if (aNameMatch && !bNameMatch) return -1;
					if (!aNameMatch && bNameMatch) return 1;

					return a.name.localeCompare(b.name);
				});

				return filtered;
			}, [files, query]);

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
							return allFilteredFiles[selectedIndex].path;
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
					<Box
						borderStyle="round"
						borderColor="blue"
						paddingX={1}
						marginTop={1}
					>
						<Text color="blue">Loading files...</Text>
					</Box>
				);
			}

			if (filteredFiles.length === 0) {
				return (
					<Box
						borderStyle="round"
						borderColor="gray"
						paddingX={1}
						marginTop={1}
					>
						<Text color="gray">No files found</Text>
					</Box>
				);
			}

			return (
				<Box paddingX={1} marginTop={1} flexDirection="column">
					<Box marginBottom={1}>
						<Text color="blue" bold>
							🗐 Files{' '}
							{allFilteredFiles.length > effectiveMaxItems &&
								`(${selectedIndex + 1}/${allFilteredFiles.length})`}
						</Text>
					</Box>
					{filteredFiles.map((file, index) => (
						<Box key={file.path}>
							<Text
								backgroundColor={
									index === displaySelectedIndex ? '#1E3A8A' : undefined
								}
								color={
									index === displaySelectedIndex
										? '#FFFFFF'
										: file.isDirectory
										? 'cyan'
										: 'white'
								}
							>
								{file.path}
							</Text>
						</Box>
					))}
					{allFilteredFiles.length > effectiveMaxItems && (
						<Box marginTop={1}>
							<Text color="gray" dimColor>
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
