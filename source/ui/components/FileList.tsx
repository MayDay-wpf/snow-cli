import React, { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, memo } from 'react';
import { Box, Text } from 'ink';
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

const FileList = memo(forwardRef<FileListRef, Props>(({
	query,
	selectedIndex,
	visible,
	maxItems = 10,
	rootPath = process.cwd(),
	onFilteredCountChange
}, ref) => {
	const [files, setFiles] = useState<FileItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);

	// Fixed maximum display items to prevent rendering issues
	const MAX_DISPLAY_ITEMS = 5;
	const effectiveMaxItems = useMemo(() => {
		return maxItems ? Math.min(maxItems, MAX_DISPLAY_ITEMS) : MAX_DISPLAY_ITEMS;
	}, [maxItems]);

	// Get files from directory - optimized to batch updates
	const loadFiles = useCallback(async () => {
		const getFilesRecursively = async (dir: string, depth: number = 0, maxDepth: number = 3): Promise<FileItem[]> => {
			if (depth > maxDepth) return [];

			try {
				const entries = await fs.promises.readdir(dir, { withFileTypes: true });
				let result: FileItem[] = [];

				for (const entry of entries) {
					// Skip hidden files and common ignore patterns
					if (entry.name.startsWith('.') ||
						entry.name === 'node_modules' ||
						entry.name === 'dist' ||
						entry.name === 'build') {
						continue;
					}

					const fullPath = path.join(dir, entry.name);
					let relativePath = path.relative(rootPath, fullPath);

					// Ensure relative paths start with ./ for consistency
					if (!relativePath.startsWith('.') && !path.isAbsolute(relativePath)) {
						relativePath = './' + relativePath;
					}

					result.push({
						name: entry.name,
						path: relativePath,
						isDirectory: entry.isDirectory()
					});

					// Recursively get files from subdirectories
					if (entry.isDirectory() && depth < maxDepth) {
						const subFiles = await getFilesRecursively(fullPath, depth + 1, maxDepth);
						result = result.concat(subFiles);
					}

					// Limit total files for performance
					if (result.length > 500) {
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
		let endIndex = Math.min(allFilteredFiles.length, startIndex + effectiveMaxItems);

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
	useImperativeHandle(ref, () => ({
		getSelectedFile: () => {
			if (allFilteredFiles.length > 0 && selectedIndex < allFilteredFiles.length && allFilteredFiles[selectedIndex]) {
				return allFilteredFiles[selectedIndex].path;
			}
			return null;
		}
	}), [allFilteredFiles, selectedIndex]);

	if (!visible) {
		return null;
	}

	if (isLoading) {
		return (
			<Box borderStyle="round" borderColor="blue" paddingX={1} marginTop={1}>
				<Text color="blue">Loading files...</Text>
			</Box>
		);
	}

	if (filteredFiles.length === 0) {
		return (
			<Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
				<Text color="gray">No files found</Text>
			</Box>
		);
	}

	// Calculate display index for the scrolling window
	const displaySelectedIndex = useMemo(() => {
		return filteredFiles.findIndex((file) => {
			const originalIndex = allFilteredFiles.indexOf(file);
			return originalIndex === selectedIndex;
		});
	}, [filteredFiles, allFilteredFiles, selectedIndex]);

	return (
		<Box paddingX={1} marginTop={1} flexDirection="column">
			<Box marginBottom={1}>
				<Text color="blue" bold>
					🗐 Files {allFilteredFiles.length > effectiveMaxItems && `(${selectedIndex + 1}/${allFilteredFiles.length})`}
				</Text>
			</Box>
			{filteredFiles.map((file, index) => (
				<Box key={file.path}>
					<Text
						backgroundColor={index === displaySelectedIndex ? "blue" : undefined}
						color={index === displaySelectedIndex ? "white" : file.isDirectory ? "cyan" : "white"}
					>
						{file.path}
					</Text>
				</Box>
			))}
			{allFilteredFiles.length > effectiveMaxItems && (
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						↑↓ to scroll · {allFilteredFiles.length - effectiveMaxItems} more hidden
					</Text>
				</Box>
			)}
		</Box>
	);
}));

FileList.displayName = 'FileList';

export default FileList;