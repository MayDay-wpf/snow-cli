import React, { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
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

const FileList = forwardRef<FileListRef, Props>(({ 
	query, 
	selectedIndex, 
	visible, 
	maxItems = 10,
	rootPath = process.cwd(),
	onFilteredCountChange
}, ref) => {
	const [files, setFiles] = useState<FileItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [loadingDebounce, setLoadingDebounce] = useState<NodeJS.Timeout | null>(null);

	// Get files from directory with performance optimization
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
					if (result.length > 1000) {
						break;
					}
					
					// Yield control to prevent blocking
					if (result.length % 100 === 0) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
				}
				
				return result;
			} catch (error) {
				return [];
			}
		};
		
		setIsLoading(true);
		try {
			const fileList = await getFilesRecursively(rootPath);
			setFiles(fileList);
		} catch (error) {
			setFiles([]);
		} finally {
			setIsLoading(false);
		}
	}, [rootPath]);

	// Load files on mount with debouncing
	useEffect(() => {
		// Clear any existing debounce
		if (loadingDebounce) {
			clearTimeout(loadingDebounce);
		}
		
		// Only load files if component is visible
		if (visible) {
			// Debounce file loading to prevent excessive calls
			const timeout = setTimeout(() => {
				loadFiles();
			}, 100);
			setLoadingDebounce(timeout);
		}
		
		return () => {
			if (loadingDebounce) {
				clearTimeout(loadingDebounce);
			}
		};
	}, [loadFiles, visible]);

	// Filter files based on query
	const filteredFiles = useMemo(() => {
		let filtered: FileItem[];
		
		if (!query.trim()) {
			filtered = files.slice(0, maxItems);
		} else {
			const queryLower = query.toLowerCase();
			filtered = files.filter(file => {
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
			
			filtered = filtered.slice(0, maxItems);
		}
		
		return filtered;
	}, [files, query, maxItems]);

	// Notify parent of filtered count changes in useEffect to avoid render-time state updates
	useEffect(() => {
		if (onFilteredCountChange) {
			onFilteredCountChange(filteredFiles.length);
		}
	}, [filteredFiles.length, onFilteredCountChange]);

	// Expose methods to parent
	useImperativeHandle(ref, () => ({
		getSelectedFile: () => {
			if (filteredFiles.length > 0 && selectedIndex < filteredFiles.length && filteredFiles[selectedIndex]) {
				return filteredFiles[selectedIndex].path;
			}
			return null;
		}
	}), [filteredFiles, selectedIndex]);

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

	return (
		<Box borderStyle="round" borderColor="blue" paddingX={1} marginTop={1} flexDirection="column">
			<Box marginBottom={1}>
				<Text color="blue" bold>Files ({filteredFiles.length})</Text>
				<Text color="gray" dimColor>◻︎:Directory ◼︎:File</Text>
			</Box>
			{filteredFiles.map((file, index) => (
				<Box key={file.path}>
					<Text 
						backgroundColor={index === selectedIndex ? "blue" : undefined}
						color={index === selectedIndex ? "white" : file.isDirectory ? "cyan" : "white"}
					>
						{file.isDirectory ? "◻︎ " : "◼︎ "}
						{file.path}
					</Text>
				</Box>
			))}
			{filteredFiles.length === maxItems && files.length > maxItems && (
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						... and {files.length - maxItems} more files
					</Text>
				</Box>
			)}
		</Box>
	);
});

FileList.displayName = 'FileList';

export default FileList;